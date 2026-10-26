import { ApiError } from '#core/errors/ApiError.js';
import { logger } from '#config/logger.js';
import { User } from '#modules/users/user.model.js';
import { paymentService } from '#services/payment/payment.service.js';
import { WalletTxn } from './wallet.model.js';

export const MAX_TOPUP = 10_00_000_00; // ₹10 lakh
export const MIN_TOPUP = 100_00;

const serializeTxn = (t) => ({
  _id: t._id,
  type: t.type,
  amount: t.amount,
  reason: t.reason,
  status: t.status,
  balanceAfter: t.balanceAfter ?? null,
  orderNumber: t.orderNumber ?? null,
  order: t.order ?? null,
  note: t.note ?? null,
  createdAt: t.createdAt,
});

/** Claims `ref` (unique), so the same change never runs twice. False when it already ran. */
async function claim(ref, doc) {
  if (!ref) return WalletTxn.create(doc);
  try {
    return await WalletTxn.create({ ...doc, ref });
  } catch (err) {
    if (err?.code === 11000) return null;
    throw err;
  }
}

/**
 * Buyer wallets: a balance on the account and a ledger of every change. Balance changes are atomic
 * ($inc, with debits conditional on the balance), and each has a ledger row.
 */
export const walletService = {
  async balance(userId) {
    const user = await User.findById(userId).select('wallet').lean();
    return user?.wallet?.balance ?? 0;
  },

  /** Adds money. With `ref`, a second call with the same ref does nothing and returns null. */
  async credit(userId, amount, { reason, order, note, by, ref } = {}) {
    if (!(amount > 0)) return null;
    const txn = await claim(ref, { user: userId, type: 'credit', amount, reason, order: order?._id, orderNumber: order?.orderNumber, note, by });
    if (!txn) return null;
    const user = await User.findByIdAndUpdate(userId, { $inc: { 'wallet.balance': amount } }, { returnDocument: 'after' }).select('wallet').lean();
    await WalletTxn.updateOne({ _id: txn._id }, { balanceAfter: user?.wallet?.balance });
    return { ...serializeTxn(txn), balanceAfter: user?.wallet?.balance };
  },

  /** Takes money, only if the balance covers it (atomically). */
  async debit(userId, amount, { reason, order, note, by, ref } = {}) {
    if (!(amount > 0)) return null;
    const user = await User.findOneAndUpdate(
      { _id: userId, 'wallet.balance': { $gte: amount } },
      { $inc: { 'wallet.balance': -amount } },
      { returnDocument: 'after' },
    )
      .select('wallet')
      .lean();
    if (!user) throw ApiError.conflict('Not enough balance in the wallet', { code: 'WALLET_INSUFFICIENT' });
    try {
      const txn = await WalletTxn.create({
        user: userId,
        type: 'debit',
        amount,
        reason,
        order: order?._id,
        orderNumber: order?.orderNumber,
        note,
        by,
        ref,
        balanceAfter: user.wallet.balance,
      });
      return serializeTxn(txn);
    } catch (err) {
      // Same ref already debited: put this one back.
      await User.updateOne({ _id: userId }, { $inc: { 'wallet.balance': amount } });
      if (err?.code === 11000) return null;
      throw err;
    }
  },

  async history(userId, { page = 1, limit = 20 } = {}) {
    const filter = { user: userId, status: { $ne: 'failed' } };
    const [rows, total, balance] = await Promise.all([
      WalletTxn.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      WalletTxn.countDocuments(filter),
      this.balance(userId),
    ]);
    return { items: rows.map(serializeTxn), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), balance } };
  },

  /* ───────────── Top-ups (Razorpay) ───────────── */

  async startTopup(user, amount) {
    const provider = await paymentService.requireOnlineProvider();
    const gatewayOrder = await provider.createOrder({
      amount,
      currency: 'INR',
      receipt: `W-${String(user._id).slice(-8)}-${Date.now().toString(36)}`.slice(0, 40),
      notes: { purpose: 'wallet_topup', userId: String(user._id) },
    });
    await WalletTxn.create({ user: user._id, type: 'credit', amount, reason: 'topup', status: 'pending', providerOrderId: gatewayOrder.providerOrderId });
    return {
      provider: 'razorpay',
      keyId: provider.publicKey,
      providerOrderId: gatewayOrder.providerOrderId,
      amount,
      currency: 'INR',
      orderNumber: 'Wallet top-up',
      prefill: { name: user.name, contact: user.phone, email: user.email ?? undefined },
    };
  },

  /** The money arrived (checkout callback or webhook): credit it once. True when it was one of ours. */
  async settleTopup(providerOrderId, paymentId) {
    const txn = await WalletTxn.findOneAndUpdate(
      { providerOrderId, reason: 'topup', status: 'pending' },
      { status: 'completed', providerPaymentId: paymentId },
      { returnDocument: 'after' },
    );
    if (!txn) return Boolean(await WalletTxn.exists({ providerOrderId, reason: 'topup' }));
    const user = await User.findByIdAndUpdate(txn.user, { $inc: { 'wallet.balance': txn.amount } }, { returnDocument: 'after' }).select('wallet').lean();
    await WalletTxn.updateOne({ _id: txn._id }, { balanceAfter: user?.wallet?.balance });
    logger.info({ userId: txn.user, amount: txn.amount }, 'Wallet topped up');
    return true;
  },

  async verifyTopup(user, { providerOrderId, paymentId, signature }) {
    const txn = await WalletTxn.findOne({ providerOrderId, user: user._id, reason: 'topup' }).lean();
    if (!txn) throw ApiError.notFound('Top-up not found');
    const provider = paymentService.webhookProvider('razorpay');
    if (!provider?.verifyCheckoutSignature({ providerOrderId, paymentId, signature })) {
      throw ApiError.badRequest('Payment verification failed. If money was deducted it will be added automatically.', { code: 'PAYMENT_VERIFICATION_FAILED' });
    }
    await this.settleTopup(providerOrderId, paymentId);
    return { balance: await this.balance(user._id) };
  },
};

// Gateway events for top-ups aren't orders: let the payment service hand them over.
paymentService.useUnknownOrderHandler((providerOrderId, paymentId) => walletService.settleTopup(providerOrderId, paymentId));
