import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { cartService } from '#modules/cart/cart.service.js';
import { Order, PaymentEvent } from '#modules/orders/order.model.js';
import { canTransitionPayment, Payment } from '#modules/orders/payment.model.js';
import { Refund } from '#modules/orders/refund.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { createRazorpayProvider } from './providers/razorpay.provider.js';

const CURRENCY = 'INR';

let razorpay = env.razorpayConfigured
  ? createRazorpayProvider({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    })
  : null;

/**
 * Production-grade Payment Subsystem.
 * Manages gateway providers, auditable payment attempts, state transitions,
 * idempotent signature verification, refunds, and webhooks.
 */
export const paymentService = {
  /* ─────────────────────────── Gateway Provider ─────────────────────────── */

  /** Online gateway available for checkout right now (configured AND enabled by admin). */
  async onlineProvider() {
    const { razorpayEnabled } = await settingsService.get('payments');
    return razorpayEnabled && razorpay ? razorpay : null;
  },

  async requireOnlineProvider() {
    const provider = await this.onlineProvider();
    if (!provider) throw ApiError.unprocessable('Online payments are currently unavailable', { code: 'PAYMENT_UNAVAILABLE' });
    return provider;
  },

  /** Webhooks must verify even if an admin disabled checkout mid-flight, so bypass the toggle. */
  webhookProvider(name) {
    if (name === 'razorpay' && razorpay) return razorpay;
    return null;
  },

  /** Test seam to inject mocked providers. */
  useRazorpay(provider) {
    razorpay = provider;
  },

  /* ─────────────────────────── Checkout Payloads ─────────────────────────── */

  checkoutPayload(order, user, providerOrderId) {
    return {
      provider: 'razorpay',
      keyId: razorpay?.publicKey || env.RAZORPAY_KEY_ID,
      providerOrderId: providerOrderId || order.payment?.providerOrderId,
      amount: order.amounts.total,
      currency: CURRENCY,
      orderNumber: order.orderNumber,
      prefill: { name: user.name, contact: user.phone, email: user.email ?? undefined },
    };
  },

  /* ─────────────────────────── Payment Attempts ─────────────────────────── */

  /**
   * Creates or safely reuses a payment attempt.
   * If a non-expired attempt is already active with the same parameters,
   * reuses it to prevent duplicate Razorpay order creation on retry/refresh.
   */
  async createOrReusePaymentAttempt(order, user, { idempotencyKey, forceNew = false } = {}) {
    const provider = await this.requireOnlineProvider();

    // 1. Check for active unexpired payment attempt
    if (!forceNew && order.payment?.providerOrderId) {
      const active = await Payment.findOne({
        orderId: order._id,
        providerOrderId: order.payment.providerOrderId,
        status: { $in: ['created', 'pending'] },
      });
      const stillValid = !order.expiresAt || order.expiresAt > new Date();
      if (active && stillValid && active.amount === order.amounts.total) {
        return {
          payment: active,
          checkoutPayload: this.checkoutPayload(order, user, active.providerOrderId),
        };
      }
    }

    // 2. Determine attempt sequence number
    const previousAttempts = await Payment.countDocuments({ orderId: order._id });
    const attemptNumber = previousAttempts + 1;
    const finalIdempotencyKey = idempotencyKey || `pay_${order._id}_${attemptNumber}_${Date.now()}`;

    // 3. Create Gateway Order
    const receipt = `${order.orderNumber}-A${attemptNumber}`.slice(0, 40);
    const gatewayOrder = await provider.createOrder({
      amount: order.amounts.total,
      currency: CURRENCY,
      receipt,
      notes: {
        orderId: String(order._id),
        orderNumber: order.orderNumber,
        attemptNumber: String(attemptNumber),
      },
    });

    // 4. Persist Payment domain record
    const payment = await Payment.create({
      orderId: order._id,
      orderNumber: order.orderNumber,
      userId: user._id,
      provider: provider.name,
      providerOrderId: gatewayOrder.providerOrderId,
      attemptNumber,
      idempotencyKey: finalIdempotencyKey,
      amount: order.amounts.total,
      currency: CURRENCY,
      status: 'pending',
    });

    // 5. Update Order with current payment attempt reference
    order.payment.provider = provider.name;
    order.payment.providerOrderId = gatewayOrder.providerOrderId;
    order.payment.currentPaymentId = payment._id;
    order.payment.status = 'pending';
    await order.save();

    return {
      payment,
      checkoutPayload: this.checkoutPayload(order, user, gatewayOrder.providerOrderId),
    };
  },

  /* ─────────────────────────── State Transitions ─────────────────────────── */

  /** Strict state machine transition helper for Payment attempts. */
  async transitionPayment(payment, targetStatus, patch = {}) {
    if (payment.status === targetStatus) {
      if (Object.keys(patch).length > 0) {
        Object.assign(payment, patch);
        await payment.save();
      }
      return payment;
    }

    if (!canTransitionPayment(payment.status, targetStatus)) {
      logger.warn(
        { paymentId: payment._id, from: payment.status, to: targetStatus },
        'Disallowed payment state machine transition attempt',
      );
      throw ApiError.conflict(`Invalid payment state transition from ${payment.status} to ${targetStatus}`, {
        code: 'INVALID_PAYMENT_TRANSITION',
      });
    }

    payment.status = targetStatus;
    if (targetStatus === 'captured') payment.capturedAt ??= new Date();
    if (targetStatus === 'failed') payment.failedAt ??= new Date();
    if (targetStatus === 'cancelled') payment.cancelledAt ??= new Date();

    Object.assign(payment, patch);
    await payment.save();
    return payment;
  },

  /* ─────────────────────────── Verification & Settlement ─────────────────── */

  /**
   * Verifies the client-provided checkout signature against trusted server HMAC.
   * Atomically transitions payment attempt to 'captured' and marks order 'paid'.
   */
  async verifyPayment(user, orderId, { providerOrderId, paymentId, signature }, { latePaymentHandler } = {}) {
    const order = await Order.findOne({ _id: orderId, user: user._id });
    if (!order) throw ApiError.notFound('Order not found');
    if (order.payment.status === 'paid') return order;

    const provider = this.webhookProvider('razorpay');
    if (!provider) throw ApiError.serviceUnavailable('Payment gateway not configured');

    if (
      providerOrderId !== order.payment.providerOrderId ||
      !provider.verifyCheckoutSignature({ providerOrderId, paymentId, signature })
    ) {
      throw ApiError.badRequest('Payment verification failed. If money was deducted it will be confirmed automatically.', {
        code: 'PAYMENT_VERIFICATION_FAILED',
      });
    }

    // Update payment attempt record
    const payment = await Payment.findOne({ providerOrderId });
    if (payment && canTransitionPayment(payment.status, 'captured')) {
      await this.transitionPayment(payment, 'captured', {
        providerPaymentId: paymentId,
        providerSignature: signature,
        signatureVerified: true,
      });
    }

    return this.markPaid({ providerOrderId, paymentId, latePaymentHandler });
  },

  /**
   * Marks an order as paid. Idempotent across multiple webhook deliveries and client callbacks.
   */
  async markPaid({ providerOrderId, paymentId, latePaymentHandler }) {
    const now = new Date();

    // Sync Payment record if exists
    const payment = await Payment.findOne({ providerOrderId });
    if (payment && canTransitionPayment(payment.status, 'captured')) {
      await this.transitionPayment(payment, 'captured', {
        providerPaymentId: paymentId,
      });
    }

    // Atomically transition order
    const order = await Order.findOneAndUpdate(
      { 'payment.providerOrderId': providerOrderId, status: 'pending_payment' },
      {
        $set: {
          status: 'placed',
          'payment.status': 'paid',
          'payment.providerPaymentId': paymentId,
          'payment.paidAt': now,
        },
        $unset: { expiresAt: 1, 'payment.failureReason': 1 },
      },
      { returnDocument: 'after' },
    );

    if (order) {
      await cartService.removeProducts(
        order.user,
        order.items.map((i) => i.product),
      );
      return order;
    }

    const existing = await Order.findOne({ 'payment.providerOrderId': providerOrderId });
    if (!existing) throw ApiError.notFound('Order not found for this payment');
    if (['paid', 'refunded', 'partially_refunded'].includes(existing.payment.status)) return existing;

    if (existing.status === 'cancelled' && latePaymentHandler) {
      return latePaymentHandler(existing, paymentId);
    }
    return existing;
  },

  /** Records client-reported or gateway-notified failure on payment attempt. */
  async recordPaymentFailure(user, orderId, reason, code = null) {
    const cleanReason = reason?.slice(0, 300) ?? 'Payment failed';
    await Order.updateOne(
      { _id: orderId, user: user._id, status: 'pending_payment' },
      { 'payment.failureReason': cleanReason },
    );

    const payment = await Payment.findOne({ orderId, status: { $in: ['created', 'pending'] } }).sort({ attemptNumber: -1 });
    if (payment && canTransitionPayment(payment.status, 'failed')) {
      await this.transitionPayment(payment, 'failed', {
        failureCode: code,
        failureReason: cleanReason,
      });
    }
  },

  /* ─────────────────────────── Refunds ─────────────────────────── */

  /**
   * Processes a refund via Razorpay with strict idempotency and audit record creation.
   */
  async processRefund({ order, itemId, amount, reason, idempotencyKey }) {
    if (order.payment.method !== 'razorpay' || !order.payment.providerPaymentId) {
      throw ApiError.badRequest('Order was not paid via online gateway');
    }
    if (amount <= 0) return null;

    const finalKey = idempotencyKey || `refund_${order._id}_${itemId || 'all'}_${Date.now()}`;

    // 1. Check for existing refund with same idempotency key
    const existing = await Refund.findOne({ idempotencyKey: finalKey });
    if (existing && existing.status === 'processed') {
      return existing;
    }

    const provider = this.webhookProvider('razorpay');
    if (!provider) throw ApiError.serviceUnavailable('Refunds are unavailable: payment gateway not configured');

    // 2. Create pending refund record
    let refundRecord =
      existing ||
      (await Refund.create({
        orderId: order._id,
        paymentId: order.payment.currentPaymentId,
        itemId,
        provider: 'razorpay',
        providerPaymentId: order.payment.providerPaymentId,
        amount,
        currency: CURRENCY,
        status: 'pending',
        reason,
        idempotencyKey: finalKey,
      }));

    // 3. Execute gateway refund
    try {
      const gatewayRefund = await provider.refund(order.payment.providerPaymentId, {
        amount,
        notes: {
          orderNumber: order.orderNumber,
          itemId: itemId ? String(itemId) : undefined,
          refundRecordId: String(refundRecord._id),
        },
      });

      refundRecord.providerRefundId = gatewayRefund.refundId;
      refundRecord.status = 'processed';
      refundRecord.processedAt = new Date();
      await refundRecord.save();

      // 4. Update Payment record if exists
      const payment = await Payment.findOne({ providerPaymentId: order.payment.providerPaymentId });
      if (payment) {
        const nextPaymentStatus =
          order.amounts.refunded + amount >= order.amounts.total ? 'refunded' : 'partially_refunded';
        if (canTransitionPayment(payment.status, nextPaymentStatus)) {
          await this.transitionPayment(payment, nextPaymentStatus);
        }
      }

      return refundRecord;
    } catch (err) {
      refundRecord.status = 'failed';
      refundRecord.failureReason = err.message?.slice(0, 300);
      await refundRecord.save();
      throw err;
    }
  },

  /* ─────────────────────────── Webhook Handling ─────────────────────────── */

  /**
   * Processes incoming Razorpay webhooks idempotently with raw signature verification.
   */
  async handleRazorpayWebhook({ rawBody, signature, eventId }, { latePaymentHandler } = {}) {
    const provider = this.webhookProvider('razorpay');
    if (!provider) throw ApiError.serviceUnavailable('Razorpay not configured');
    if (!provider.verifyWebhookSignature(rawBody, signature)) {
      throw ApiError.badRequest('Invalid webhook signature', { code: 'INVALID_SIGNATURE' });
    }

    const event = JSON.parse(rawBody.toString('utf8'));
    const payment = event.payload?.payment?.entity;
    const providerOrderId = payment?.order_id ?? event.payload?.order?.entity?.id;
    const id = eventId || `${event.event}:${payment?.id ?? providerOrderId}`;

    // Deduplication via unique index on PaymentEvent
    try {
      await PaymentEvent.create({ provider: 'razorpay', eventId: id, type: event.event, providerOrderId, payload: event });
    } catch (err) {
      if (err?.code === 11000) return { duplicate: true };
      throw err;
    }

    try {
      if ((event.event === 'payment.captured' || event.event === 'order.paid') && providerOrderId) {
        await this.markPaid({ providerOrderId, paymentId: payment?.id, latePaymentHandler });
      } else if (event.event === 'payment.failed' && providerOrderId) {
        await Order.updateOne(
          { 'payment.providerOrderId': providerOrderId, status: 'pending_payment' },
          { 'payment.failureReason': payment?.error_description?.slice(0, 300) ?? 'Payment failed' },
        );
        const pRecord = await Payment.findOne({ providerOrderId });
        if (pRecord && canTransitionPayment(pRecord.status, 'failed')) {
          await this.transitionPayment(pRecord, 'failed', {
            failureCode: payment?.error_code,
            failureReason: payment?.error_description?.slice(0, 300),
          });
        }
      }
      await PaymentEvent.updateOne({ provider: 'razorpay', eventId: id }, { processedAt: new Date() });
      return { processed: true };
    } catch (err) {
      // Allow retry on unhandled exception
      await PaymentEvent.deleteOne({ provider: 'razorpay', eventId: id });
      throw err;
    }
  },

  /* ─────────────────────────── Reconciliation ─────────────────────────── */

  /**
   * Reconciles an order's payment status by verifying with Razorpay server.
   * Useful when user closes browser before verify endpoint is reached.
   */
  async reconcileOrderPayment(order, { latePaymentHandler } = {}) {
    if (order.status !== 'pending_payment' || !order.payment?.providerOrderId) return false;
    const provider = this.webhookProvider('razorpay');
    if (!provider || !provider.fetchOrderPayments) return false;

    try {
      const payments = await provider.fetchOrderPayments(order.payment.providerOrderId);
      const captured = payments.find((p) => p.captured || p.status === 'captured');
      if (captured) {
        logger.info({ orderId: order._id, paymentId: captured.id }, 'Reconciled captured payment for pending order');
        await this.markPaid({
          providerOrderId: order.payment.providerOrderId,
          paymentId: captured.id,
          latePaymentHandler,
        });
        return true;
      }
    } catch (err) {
      logger.warn({ orderId: order._id, err: err.message }, 'Failed to reconcile payment with Razorpay');
    }
    return false;
  },
};
