import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { gstFromInclusive } from '#core/utils/money.js';
import { escapeRegex } from '#core/utils/strings.js';
import { cartService } from '#modules/cart/cart.service.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { userService } from '#modules/users/user.service.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { ITEM_TRANSITIONS, Order, PaymentEvent } from './order.model.js';
import { serializeOrder, serializeVendorOrder } from './order.serializer.js';

const CURRENCY = 'INR';

function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `TB${ymd}-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
}

/** Atomically decrements stock line by line; rolls back what it took if any line fails. */
async function reserveStock(lines) {
  const taken = [];
  for (const line of lines) {
    const res = await Product.updateOne(
      { _id: line.product, ...VISIBLE, 'inventory.stock': { $gte: line.quantity } },
      { $inc: { 'inventory.stock': -line.quantity } },
    );
    if (!res.modifiedCount) {
      await releaseStock(taken);
      throw ApiError.conflict(`${line.name} just went out of stock. Please review your cart.`, { code: 'OUT_OF_STOCK', details: { product: line.product } });
    }
    taken.push(line);
  }
}

async function releaseStock(lines) {
  if (!lines.length) return;
  await Product.bulkWrite(lines.map((l) => ({ updateOne: { filter: { _id: l.product }, update: { $inc: { 'inventory.stock': l.quantity } } } })));
}

function deriveStatus(order) {
  if (order.status === 'pending_payment') return order.status;
  const statuses = order.items.map((i) => i.status);
  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.every((s) => s === 'delivered' || s === 'cancelled')) return 'completed';
  if (statuses.some((s) => s !== 'pending' && s !== 'cancelled')) return 'processing';
  return 'placed';
}

function checkoutPayload(order, user) {
  return {
    provider: 'razorpay',
    keyId: env.RAZORPAY_KEY_ID,
    providerOrderId: order.payment.providerOrderId,
    amount: order.amounts.total,
    currency: CURRENCY,
    orderNumber: order.orderNumber,
    prefill: { name: user.name, contact: user.phone, email: user.email ?? undefined },
  };
}

/** Marks an online order paid. Idempotent: safe to call from both checkout verification and webhooks. */
async function markPaid({ providerOrderId, paymentId }) {
  const now = new Date();
  const order = await Order.findOneAndUpdate(
    { 'payment.providerOrderId': providerOrderId, status: 'pending_payment' },
    {
      $set: { status: 'placed', 'payment.status': 'paid', 'payment.providerPaymentId': paymentId, 'payment.paidAt': now },
      $unset: { expiresAt: 1, 'payment.failureReason': 1 },
    },
    { returnDocument: 'after' },
  );
  if (order) {
    await cartService.removeProducts(order.user, order.items.map((i) => i.product));
    return order;
  }

  const existing = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
  if (!existing) throw ApiError.notFound('Order not found for this payment');
  if (['paid', 'refunded', 'partially_refunded'].includes(existing.payment.status)) return existing;

  if (existing.status === 'cancelled') return handleLatePayment(existing, paymentId);
  return existing;
}

/** Payment landed after the order expired and released its stock: re-reserve, or refund in full. */
async function handleLatePayment(order, paymentId) {
  const lines = order.items.map((i) => ({ product: i.product, quantity: i.quantity, name: i.name }));
  try {
    await reserveStock(lines);
    order.status = 'placed';
    order.cancelledAt = undefined;
    order.cancelReason = undefined;
    for (const item of order.items) {
      item.status = 'pending';
      item.history.push({ status: 'pending', by: { kind: 'system' }, note: 'Payment received after expiry' });
    }
    order.payment.status = 'paid';
    order.payment.providerPaymentId = paymentId;
    order.payment.paidAt = new Date();
    await order.save();
    return order;
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'OUT_OF_STOCK') throw err;
    const provider = paymentService.webhookProvider('razorpay');
    const refund = await provider.refund(paymentId, { notes: { reason: 'Order expired and stock unavailable' } });
    order.payment.status = 'refunded';
    order.payment.providerPaymentId = paymentId;
    order.amounts.refunded = order.amounts.total;
    order.refunds.push({ amount: refund.amount, providerRefundId: refund.refundId, status: refund.status });
    await order.save();
    logger.warn({ orderId: order._id }, 'Late payment refunded: stock no longer available');
    return order;
  }
}

async function refundForCancellation(order, item) {
  if (order.payment.method !== 'razorpay' || !['paid', 'partially_refunded'].includes(order.payment.status) || item.refunded) return null;

  const remainingActive = order.items.filter((i) => i.status !== 'cancelled' && String(i._id) !== String(item._id));
  // Cancelling the last active line refunds everything left, including shipping.
  const amount = remainingActive.length ? item.lineTotal : order.amounts.total - order.amounts.refunded;
  if (amount <= 0) return null;

  const provider = paymentService.webhookProvider('razorpay');
  if (!provider) throw ApiError.serviceUnavailable('Refunds are unavailable: payment gateway not configured');
  return { amount, ...(await provider.refund(order.payment.providerPaymentId, { amount, notes: { orderNumber: order.orderNumber, itemId: String(item._id) } })) };
}

export const orderService = {
  /* ─────────────────────────── Checkout ─────────────────────────── */

  async checkout(user, { addressId, paymentMethod, notes, gstin, businessName }) {
    const cart = await cartService.view(user._id);
    if (!cart.items.length) throw ApiError.unprocessable('Your cart is empty', { code: 'CART_EMPTY' });
    if (cart.hasIssues) {
      throw ApiError.conflict('Some items in your cart need attention', {
        code: 'CART_HAS_ISSUES',
        details: cart.items.filter((i) => i.issue).map((i) => ({ productId: i.productId, issue: i.issue })),
      });
    }

    const address = await userService.address(user._id, addressId);
    const payments = await settingsService.get('payments');
    const { total } = cart.summary;

    let provider = null;
    if (paymentMethod === 'cod') {
      if (!payments.codEnabled) throw ApiError.unprocessable('Cash on delivery is not available', { code: 'COD_UNAVAILABLE' });
      if (payments.codMaxOrderValue && total > payments.codMaxOrderValue) {
        throw ApiError.unprocessable('This order is above the cash on delivery limit. Please pay online.', { code: 'COD_LIMIT' });
      }
    } else {
      provider = await paymentService.requireOnlineProvider();
    }

    const lines = cart.items.map(({ _product: p, quantity, lineTotal, unitPrice, unitMrp, gstRate }) => ({
      product: p._id,
      vendor: p.vendor,
      name: p.name,
      slug: p.slug,
      sku: p.sku,
      image: p.images?.[0]?.url,
      type: p.type,
      hsnCode: p.hsnCode,
      unitPrice,
      unitMrp,
      gstRate,
      quantity,
      lineTotal,
      taxAmount: gstFromInclusive(lineTotal, gstRate),
      status: 'pending',
      history: [{ status: 'pending', by: { kind: 'user', id: user._id } }],
    }));

    await reserveStock(lines);

    let order;
    try {
      order = await Order.create({
        orderNumber: newOrderNumber(),
        user: user._id,
        items: lines,
        vendors: [...new Set(lines.map((l) => String(l.vendor)))],
        shippingAddress: {
          name: address.name,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2,
          landmark: address.landmark,
          city: address.city,
          state: address.state,
          pincode: address.pincode,
        },
        billing: {
          name: user.name,
          businessName: businessName ?? user.business?.name,
          gstin: gstin ?? user.business?.gstin,
        },
        notes,
        amounts: { subtotal: cart.summary.subtotal, tax: cart.summary.tax, shipping: cart.summary.shipping, discount: 0, total },
        payment: { method: paymentMethod, status: 'pending', provider: provider?.name },
        status: paymentMethod === 'cod' ? 'placed' : 'pending_payment',
        expiresAt: paymentMethod === 'cod' ? undefined : new Date(Date.now() + env.ORDER_PAYMENT_WINDOW_MINUTES * 60_000),
      });
    } catch (err) {
      await releaseStock(lines);
      throw err;
    }

    if (paymentMethod === 'cod') {
      await cartService.removeProducts(user._id, lines.map((l) => l.product));
      return { order: serializeOrder(order), payment: null };
    }

    try {
      const gatewayOrder = await provider.createOrder({
        amount: total,
        currency: CURRENCY,
        receipt: order.orderNumber,
        notes: { orderId: String(order._id), orderNumber: order.orderNumber },
      });
      order.payment.providerOrderId = gatewayOrder.providerOrderId;
      await order.save();
    } catch (err) {
      await Order.updateOne({ _id: order._id }, { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Payment could not be started', 'items.$[].status': 'cancelled' });
      await releaseStock(lines);
      throw err;
    }

    return { order: serializeOrder(order), payment: checkoutPayload(order, user) };
  },

  async verifyPayment(user, orderId, { providerOrderId, paymentId, signature }) {
    const order = await Order.findOne({ _id: orderId, user: user._id });
    if (!order) throw ApiError.notFound('Order not found');
    if (order.payment.status === 'paid') return serializeOrder(order);

    const provider = paymentService.webhookProvider('razorpay');
    if (!provider) throw ApiError.serviceUnavailable('Payment gateway not configured');
    if (providerOrderId !== order.payment.providerOrderId || !provider.verifyCheckoutSignature({ providerOrderId, paymentId, signature })) {
      throw ApiError.badRequest('Payment verification failed. If money was deducted it will be confirmed automatically.', {
        code: 'PAYMENT_VERIFICATION_FAILED',
      });
    }
    return serializeOrder(await markPaid({ providerOrderId, paymentId }));
  },

  /** Re-opens checkout for an unpaid, unexpired order. */
  async retryPayment(user, orderId) {
    const order = await Order.findOne({ _id: orderId, user: user._id });
    if (!order) throw ApiError.notFound('Order not found');
    if (order.status !== 'pending_payment' || !order.payment.providerOrderId) {
      throw ApiError.conflict('This order is not awaiting payment', { code: 'NOT_AWAITING_PAYMENT' });
    }
    if (order.expiresAt && order.expiresAt < new Date()) throw ApiError.conflict('The payment window has closed. Please place the order again.', { code: 'PAYMENT_WINDOW_CLOSED' });
    return { order: serializeOrder(order), payment: checkoutPayload(order, user) };
  },

  async recordPaymentFailure(user, orderId, reason) {
    await Order.updateOne({ _id: orderId, user: user._id, status: 'pending_payment' }, { 'payment.failureReason': reason?.slice(0, 300) });
  },

  /* ─────────────────────────── Webhooks & jobs ─────────────────────────── */

  async handleRazorpayWebhook({ rawBody, signature, eventId }) {
    const provider = paymentService.webhookProvider('razorpay');
    if (!provider) throw ApiError.serviceUnavailable('Razorpay not configured');
    if (!provider.verifyWebhookSignature(rawBody, signature)) throw ApiError.badRequest('Invalid webhook signature', { code: 'INVALID_SIGNATURE' });

    const event = JSON.parse(rawBody.toString('utf8'));
    const payment = event.payload?.payment?.entity;
    const providerOrderId = payment?.order_id ?? event.payload?.order?.entity?.id;
    const id = eventId || `${event.event}:${payment?.id ?? providerOrderId}`;

    try {
      await PaymentEvent.create({ provider: 'razorpay', eventId: id, type: event.event, providerOrderId, payload: event });
    } catch (err) {
      if (err?.code === 11000) return { duplicate: true };
      throw err;
    }

    try {
      if ((event.event === 'payment.captured' || event.event === 'order.paid') && providerOrderId) {
        await markPaid({ providerOrderId, paymentId: payment?.id });
      } else if (event.event === 'payment.failed' && providerOrderId) {
        await Order.updateOne(
          { 'payment.providerOrderId': providerOrderId, status: 'pending_payment' },
          { 'payment.failureReason': payment?.error_description?.slice(0, 300) ?? 'Payment failed' },
        );
      }
      await PaymentEvent.updateOne({ provider: 'razorpay', eventId: id }, { processedAt: new Date() });
      return { processed: true };
    } catch (err) {
      // Drop the record so Razorpay's retry can process it again.
      await PaymentEvent.deleteOne({ provider: 'razorpay', eventId: id });
      throw err;
    }
  },

  /** Cancels online orders whose payment window elapsed and returns their stock. */
  async expireUnpaid(now = new Date()) {
    const stale = await Order.find({ status: 'pending_payment', expiresAt: { $lte: now } }).select('_id').limit(200).lean();
    let expired = 0;
    for (const { _id } of stale) {
      const claimed = await Order.findOneAndUpdate(
        { _id, status: 'pending_payment' },
        { status: 'cancelled', cancelledAt: now, cancelReason: 'Payment not completed in time', 'payment.status': 'failed', 'items.$[].status': 'cancelled' },
      ).lean();
      if (claimed) {
        await releaseStock(claimed.items.map((i) => ({ product: i.product, quantity: i.quantity })));
        expired += 1;
      }
    }
    return expired;
  },

  /* ─────────────────────────── Fulfilment ─────────────────────────── */

  /**
   * Moves one line item through fulfilment. Handles restock + refund on cancellation.
   * @param {{ orderId: string, itemId: string, vendorId?: any, userId?: any }} scope
   */
  async updateItem(scope, { status, tracking, note }, actor) {
    const filter = { _id: scope.orderId };
    if (scope.userId) filter.user = scope.userId;
    if (scope.vendorId) filter.vendors = scope.vendorId;
    const order = await Order.findOne(filter);
    const item = order?.items.id(scope.itemId);
    if (!order || !item || (scope.vendorId && String(item.vendor) !== String(scope.vendorId))) throw ApiError.notFound('Order item not found');
    if (order.status === 'pending_payment') throw ApiError.conflict('This order is still awaiting payment', { code: 'AWAITING_PAYMENT' });

    const changingStatus = status && status !== item.status;
    if (changingStatus) {
      if (!ITEM_TRANSITIONS[item.status].includes(status)) {
        throw ApiError.conflict(`An item that is ${item.status} cannot be marked ${status}`, { code: 'INVALID_TRANSITION' });
      }
      if (actor.kind === 'user' && (status !== 'cancelled' || !['pending', 'confirmed'].includes(item.status))) {
        throw ApiError.forbidden('This item can no longer be cancelled. Contact support for help.', { code: 'CANNOT_CANCEL' });
      }
    }

    const refund = changingStatus && status === 'cancelled' ? await refundForCancellation(order, item) : null;

    if (changingStatus) {
      item.status = status;
      item.history.push({ status, by: actor, note });
    }
    for (const [key, value] of Object.entries(tracking ?? {})) item.set(`tracking.${key}`, value);

    if (refund) {
      item.refunded = true;
      order.amounts.refunded += refund.amount;
      order.refunds.push({ itemId: item._id, amount: refund.amount, providerRefundId: refund.refundId, status: refund.status });
      order.payment.status = order.amounts.refunded >= order.amounts.total ? 'refunded' : 'partially_refunded';
    }

    order.status = deriveStatus(order);
    if (order.status === 'cancelled') {
      order.cancelledAt ??= new Date();
      order.cancelReason ??= note;
    }
    // Cash is collected on delivery; once everything that wasn't cancelled is delivered, it's paid.
    if (order.payment.method === 'cod' && order.status === 'completed' && order.payment.status === 'pending') {
      order.payment.status = 'paid';
      order.payment.paidAt = new Date();
    }

    await order.save();
    if (changingStatus && status === 'cancelled') await releaseStock([{ product: item.product, quantity: item.quantity }]);
    return order;
  },

  /* ─────────────────────────── Queries ─────────────────────────── */

  async userList(userId, { page, limit }) {
    const filter = { user: userId };
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return { items: rows.map(serializeOrder), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async userGet(userId, id) {
    const order = await Order.findOne({ _id: id, user: userId }).lean();
    if (!order) throw ApiError.notFound('Order not found');
    return serializeOrder(order);
  },

  async vendorList(vendorId, { page, limit, status, q }) {
    const filter = { vendors: vendorId, status: { $ne: 'pending_payment' } };
    if (status) filter.items = { $elemMatch: { vendor: vendorId, status } };
    if (q) filter.orderNumber = new RegExp(escapeRegex(q), 'i');
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Order.countDocuments(filter),
    ]);
    return { items: rows.map((o) => serializeVendorOrder(o, vendorId)), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async vendorGet(vendorId, id) {
    const order = await Order.findOne({ _id: id, vendors: vendorId, status: { $ne: 'pending_payment' } }).lean();
    if (!order) throw ApiError.notFound('Order not found');
    return serializeVendorOrder(order, vendorId);
  },

  async adminList({ page, limit, status, paymentMethod, paymentStatus, q, vendor, from, to }) {
    const filter = {};
    if (status) filter.status = status;
    if (paymentMethod) filter['payment.method'] = paymentMethod;
    if (paymentStatus) filter['payment.status'] = paymentStatus;
    if (vendor) filter.vendors = new mongoose.Types.ObjectId(vendor);
    if (q) filter.orderNumber = new RegExp(escapeRegex(q), 'i');
    if (from || to) filter.createdAt = { ...(from ? { $gte: from } : {}), ...(to ? { $lte: to } : {}) };
    const [rows, total] = await Promise.all([
      Order.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name phone')
        .lean(),
      Order.countDocuments(filter),
    ]);
    return {
      items: rows.map((o) => ({ ...serializeOrder(o), user: o.user })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async adminGet(id) {
    const order = await Order.findById(id).populate('user', 'name phone email').populate('items.vendor', 'store.name store.slug phone').lean();
    if (!order) throw ApiError.notFound('Order not found');
    // user and items.vendor are populated, and the serializer passes them through.
    return serializeOrder(order);
  },

  serializeOrder,
  serializeVendorOrder,
};
