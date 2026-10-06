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
import { quoteLifecycle } from '#modules/quotes/quote.lifecycle.js';
import { Shipment } from '#modules/shipping/shipment.model.js';
import { shippingQuotes } from '#modules/shipping/shipping.quotes.js';
import { userService } from '#modules/users/user.service.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { ITEM_TRANSITIONS, Order, PaymentEvent } from './order.model.js';
import { onlineAmount, splitPartial } from './partialPayment.js';
import { serializeOrder, serializeVendorOrder } from './order.serializer.js';

const CURRENCY = 'INR';

function newOrderNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `TB${ymd}-${crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6)}`;
}

/** Stock filter/update for one line: the variant's counter (plus the product total) or the product's. */
function stockOps(line) {
  const variantId = line.variant?.id;
  if (variantId) {
    return {
      filter: (qty) => ({ variants: { $elemMatch: { _id: variantId, available: { $ne: false }, stock: { $gte: qty } } } }),
      update: (delta) => ({ $inc: { 'variants.$[v].stock': delta, 'inventory.stock': delta } }),
      options: { arrayFilters: [{ 'v._id': variantId }] },
    };
  }
  return {
    filter: (qty) => ({ 'inventory.stock': { $gte: qty } }),
    update: (delta) => ({ $inc: { 'inventory.stock': delta } }),
    options: {},
  };
}

/** Atomically decrements stock line by line; rolls back what it took if any line fails. Untracked lines only need availability. */
async function reserveStock(lines) {
  const taken = [];
  for (const line of lines) {
    const ops = stockOps(line);
    const filter = { _id: line.product, ...VISIBLE, 'inventory.available': { $ne: false } };
    const variantId = line.variant?.id;
    const res =
      line.stockTracked === false
        ? {
            modifiedCount: await Product.countDocuments({
              ...filter,
              'inventory.trackQuantity': false,
              ...(variantId ? { variants: { $elemMatch: { _id: variantId, available: { $ne: false } } } } : {}),
            }),
          }
        : await Product.updateOne(
            { ...filter, 'inventory.trackQuantity': { $ne: false }, ...ops.filter(line.quantity) },
            ops.update(-line.quantity),
            ops.options,
          );
    if (!res.modifiedCount) {
      await releaseStock(taken);
      throw ApiError.conflict(`${line.name} just went out of stock. Please review your cart.`, {
        code: 'OUT_OF_STOCK',
        details: { product: line.product },
      });
    }
    taken.push(line);
  }
}

async function releaseStock(lines) {
  const tracked = lines.filter((l) => l.stockTracked !== false);
  if (!tracked.length) return;
  await Product.bulkWrite(
    tracked.map((l) => {
      const ops = stockOps(l);
      return { updateOne: { filter: { _id: l.product }, update: ops.update(l.quantity), ...ops.options } };
    }),
  );
}

/** What reserve/release need from an order item. */
const stockLine = (i) => ({ product: i.product, variant: i.variant, quantity: i.quantity, stockTracked: i.stockTracked, name: i.name });

function deriveStatus(order) {
  if (order.status === 'pending_payment') return order.status;
  const statuses = order.items.map((i) => i.status);
  if (statuses.every((s) => s === 'cancelled')) return 'cancelled';
  if (statuses.every((s) => s === 'delivered' || s === 'cancelled')) return 'completed';
  if (statuses.some((s) => s !== 'pending' && s !== 'cancelled')) return 'processing';
  return 'placed';
}

function checkoutPayload(order, user) {
  return paymentService.checkoutPayload(order, user, order.payment.providerOrderId);
}

/** Marks an online order paid. Idempotent: safe to call from both checkout verification and webhooks. */
async function markPaid({ providerOrderId, paymentId }) {
  return paymentService.markPaid({ providerOrderId, paymentId, latePaymentHandler: handleLatePayment });
}

/** Payment landed after the order expired and released its stock: re-reserve, or refund in full. */
async function handleLatePayment(order, paymentId) {
  const lines = order.items.map(stockLine);
  try {
    await reserveStock(lines);
    order.status = 'placed';
    order.cancelledAt = undefined;
    order.cancelReason = undefined;
    for (const item of order.items) {
      item.status = 'pending';
      item.history.push({ status: 'pending', by: { kind: 'system' }, note: 'Payment received after expiry' });
    }
    order.payment.status = order.payment.method === 'partial' ? 'partially_paid' : 'paid';
    order.payment.providerPaymentId = paymentId;
    order.payment.paidAt = new Date();
    await order.save();
    await quoteLifecycle.markOrdered(order);
    return order;
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'OUT_OF_STOCK') throw err;
    const provider = paymentService.webhookProvider('razorpay');
    const refund = await provider.refund(paymentId, { notes: { reason: 'Order expired and stock unavailable' } });
    order.payment.status = 'refunded';
    order.payment.providerPaymentId = paymentId;
    order.amounts.refunded = onlineAmount(order);
    order.refunds.push({ amount: refund.amount, providerRefundId: refund.refundId, status: refund.status });
    await order.save();
    logger.warn({ orderId: order._id }, 'Late payment refunded: stock no longer available');
    return order;
  }
}

/**
 * Partial orders: cancelling a line first lowers the cash the courier collects; only the part of
 * the advance no longer covered by what's still owed is refunded.
 * @returns {{ amount: number, refundId?: string, status?: string, balanceDue: number } | null}
 */
async function settlePartialCancellation(order, item) {
  if (
    order.payment.method !== 'partial' ||
    !['partially_paid', 'paid', 'partially_refunded'].includes(order.payment.status) ||
    item.refunded
  ) {
    return null;
  }
  const remaining = order.items.filter((i) => i.status !== 'cancelled' && String(i._id) !== String(item._id));
  const stillOwed = remaining.length ? remaining.reduce((s, i) => s + i.lineTotal, 0) + order.amounts.shipping : 0;
  const paidOnline = (order.amounts.advance ?? 0) - order.amounts.refunded;
  const balanceDue = Math.max(0, stillOwed - paidOnline);
  const excess = Math.max(0, paidOnline - stillOwed);
  if (!excess) return { amount: 0, balanceDue };
  const refund = await paymentService.processRefund({
    order,
    itemId: item._id,
    amount: excess,
    reason: `Cancelled item ${item.name}`,
    idempotencyKey: `cancel_refund_${order._id}_${item._id}`,
  });
  return { amount: refund.amount, refundId: refund.providerRefundId, status: refund.status, balanceDue };
}

async function refundForCancellation(order, item) {
  if (order.payment.method === 'partial') return settlePartialCancellation(order, item);
  if (order.payment.method !== 'razorpay' || !['paid', 'partially_refunded'].includes(order.payment.status) || item.refunded) return null;

  const remainingActive = order.items.filter((i) => i.status !== 'cancelled' && String(i._id) !== String(item._id));
  // Cancelling the last active line refunds everything left, including shipping.
  const amount = remainingActive.length ? item.lineTotal : order.amounts.total - order.amounts.refunded;
  if (amount <= 0) return null;

  const refund = await paymentService.processRefund({
    order,
    itemId: item._id,
    amount,
    reason: `Cancelled item ${item.name}`,
    idempotencyKey: `cancel_refund_${order._id}_${item._id}`,
  });
  return {
    amount: refund.amount,
    refundId: refund.providerRefundId,
    status: refund.status,
  };
}

export const orderService = {
  /* ─────────────────────────── Checkout ─────────────────────────── */

  async checkout(user, { addressId, paymentMethod, notes, gstin, businessName, idempotencyKey }) {
    if (idempotencyKey) {
      const existing = await Order.findOne({ user: user._id, idempotencyKey });
      if (existing) {
        let payment = null;
        if (['razorpay', 'partial'].includes(existing.payment.method) && existing.status === 'pending_payment') {
          payment = paymentService.checkoutPayload(existing, user, existing.payment.providerOrderId);
        }
        return { order: serializeOrder(existing), payment };
      }
    }

    const cart = await cartService.view(user._id);
    if (!cart.items.length) throw ApiError.unprocessable('Your cart is empty', { code: 'CART_EMPTY' });
    if (cart.hasIssues) {
      throw ApiError.conflict('Some items in your cart need attention', {
        code: 'CART_HAS_ISSUES',
        details: cart.items.filter((i) => i.issue).map((i) => ({ productId: i.productId, issue: i.issue })),
      });
    }

    const address = await userService.address(user._id, addressId);
    await shippingQuotes.assertCheckoutServiceable([...new Set(cart.items.map((i) => String(i._product.vendor)))], address.pincode);
    const payments = await settingsService.get('payments');
    const { total } = cart.summary;

    let provider = null;
    let split = null;
    if (paymentMethod === 'partial') {
      if (!payments.partialEnabled) throw ApiError.unprocessable('Part payment is not available', { code: 'PARTIAL_UNAVAILABLE' });
      if (total < payments.partialMinOrderValue) {
        throw ApiError.unprocessable('Part payment is available on larger orders only', { code: 'PARTIAL_MIN_ORDER' });
      }
      split = splitPartial(total, payments.partialAdvancePercent);
      if (payments.partialMaxBalance && split.balanceDue > payments.partialMaxBalance) {
        throw ApiError.unprocessable('The amount due on delivery is above the limit for this order. Please pay online in full.', {
          code: 'PARTIAL_LIMIT',
        });
      }
      provider = await paymentService.requireOnlineProvider();
    } else if (paymentMethod === 'cod') {
      if (!payments.codEnabled) throw ApiError.unprocessable('Cash on delivery is not available', { code: 'COD_UNAVAILABLE' });
      if (payments.codMaxOrderValue && total > payments.codMaxOrderValue) {
        throw ApiError.unprocessable('This order is above the cash on delivery limit. Please pay online.', { code: 'COD_LIMIT' });
      }
    } else {
      provider = await paymentService.requireOnlineProvider();
    }

    const lines = cart.items.map(
      ({ _product: p, _quote: q, _sellable: sv, quantity, lineTotal, unitPrice, baseUnitPrice, unitMrp, gstRate, pricing }) => ({
        product: p._id,
        vendor: p.vendor,
        name: p.name,
        slug: p.slug,
        sku: sv.sku,
        ...(sv.variant ? { variant: { id: sv.variant._id, title: sv.title } } : {}),
        stockTracked: p.inventory?.trackQuantity !== false,
        image: sv.image,
        type: p.type,
        hsnCode: p.hsnCode,
        unitPrice,
        basePrice: baseUnitPrice,
        unitMrp,
        pricing: { source: pricing.source, tierMinQty: pricing.tier?.minQty, quote: q?._id },
        gstRate,
        quantity,
        lineTotal,
        taxAmount: gstFromInclusive(lineTotal, gstRate),
        status: 'pending',
        history: [{ status: 'pending', by: { kind: 'user', id: user._id } }],
      }),
    );

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
        amounts: { subtotal: cart.summary.subtotal, tax: cart.summary.tax, shipping: cart.summary.shipping, discount: 0, total, ...split },
        payment: { method: paymentMethod, status: 'pending', provider: provider?.name },
        status: paymentMethod === 'cod' ? 'placed' : 'pending_payment',
        expiresAt: paymentMethod === 'cod' ? undefined : new Date(Date.now() + env.ORDER_PAYMENT_WINDOW_MINUTES * 60_000),
        idempotencyKey,
      });
    } catch (err) {
      await releaseStock(lines);
      throw err;
    }
    // A quote is consumed by the order that uses it; it's released again if that order never completes.
    await quoteLifecycle.markOrdered(order);

    if (paymentMethod === 'cod') {
      await cartService.removeProducts(
        user._id,
        lines.map((l) => l.product),
      );
      return { order: serializeOrder(order), payment: null };
    }

    try {
      const { checkoutPayload: payload } = await paymentService.createOrReusePaymentAttempt(order, user, { idempotencyKey });
      return { order: serializeOrder(order), payment: payload };
    } catch (err) {
      await Order.updateOne(
        { _id: order._id },
        { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Payment could not be started', 'items.$[].status': 'cancelled' },
      );
      await releaseStock(lines);
      await quoteLifecycle.releaseForOrder(order);
      throw err;
    }
  },

  async verifyPayment(user, orderId, { providerOrderId, paymentId, signature }) {
    const verifiedOrder = await paymentService.verifyPayment(
      user,
      orderId,
      { providerOrderId, paymentId, signature },
      { latePaymentHandler: handleLatePayment },
    );
    return serializeOrder(verifiedOrder);
  },

  /** Re-opens checkout for an unpaid, unexpired order. */
  async retryPayment(user, orderId) {
    const order = await Order.findOne({ _id: orderId, user: user._id });
    if (!order) throw ApiError.notFound('Order not found');
    if (order.status !== 'pending_payment' || !order.payment.providerOrderId) {
      throw ApiError.conflict('This order is not awaiting payment', { code: 'NOT_AWAITING_PAYMENT' });
    }
    if (order.expiresAt && order.expiresAt < new Date()) {
      throw ApiError.conflict('The payment window has closed. Please place the order again.', { code: 'PAYMENT_WINDOW_CLOSED' });
    }
    const { checkoutPayload: payload } = await paymentService.createOrReusePaymentAttempt(order, user, { forceNew: false });
    return { order: serializeOrder(order), payment: payload };
  },

  async recordPaymentFailure(user, orderId, reason) {
    await paymentService.recordPaymentFailure(user, orderId, reason);
  },

  /* ─────────────────────────── Webhooks & jobs ─────────────────────────── */

  async handleRazorpayWebhook({ rawBody, signature, eventId }) {
    return paymentService.handleRazorpayWebhook({ rawBody, signature, eventId }, { latePaymentHandler: handleLatePayment });
  },

  /** Cancels online orders whose payment window elapsed and returns their stock. */
  async expireUnpaid(now = new Date()) {
    const stale = await Order.find({ status: 'pending_payment', expiresAt: { $lte: now } }).limit(200);
    let expired = 0;
    for (const order of stale) {
      // Reconcile with Razorpay before cancelling to prevent zombie payment
      const reconciled = await paymentService.reconcileOrderPayment(order, { latePaymentHandler: handleLatePayment });
      if (reconciled) continue;

      const claimed = await Order.findOneAndUpdate(
        { _id: order._id, status: 'pending_payment' },
        {
          status: 'cancelled',
          cancelledAt: now,
          cancelReason: 'Payment not completed in time',
          'payment.status': 'failed',
          'items.$[].status': 'cancelled',
        },
      ).lean();
      if (claimed) {
        await releaseStock(claimed.items.map(stockLine));
        await quoteLifecycle.releaseForOrder(claimed);
        expired += 1;
      }
    }
    return expired;
  },

  /** Periodically reconciles pending online orders with Razorpay server. */
  async reconcilePendingPayments() {
    const minAge = new Date(Date.now() - 3 * 60_000);
    const pendingOrders = await Order.find({
      status: 'pending_payment',
      'payment.providerOrderId': { $exists: true, $ne: null },
      createdAt: { $lte: minAge },
    }).limit(50);

    let reconciledCount = 0;
    for (const order of pendingOrders) {
      const ok = await paymentService.reconcileOrderPayment(order, { latePaymentHandler: handleLatePayment });
      if (ok) reconciledCount += 1;
    }
    return reconciledCount;
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
    if (!order || !item || (scope.vendorId && String(item.vendor) !== String(scope.vendorId)))
      throw ApiError.notFound('Order item not found');
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

    // Once a parcel is booked with the courier, the line can only be cancelled after the shipment is.
    if (changingStatus && status === 'cancelled' && actor.kind !== 'system') {
      const booked = await Shipment.exists({
        order: order._id,
        vendor: item.vendor,
        type: 'forward',
        active: true,
        status: { $ne: 'pending' },
      });
      if (booked) {
        throw ApiError.conflict('This item has already been handed to the courier. Cancel the shipment first.', {
          code: 'SHIPMENT_IN_PROGRESS',
        });
      }
    }

    const refund = changingStatus && status === 'cancelled' ? await refundForCancellation(order, item) : null;

    if (changingStatus) {
      item.status = status;
      item.history.push({ status, by: actor, note });
    }
    for (const [key, value] of Object.entries(tracking ?? {})) item.set(`tracking.${key}`, value);

    if (refund && order.payment.method === 'partial') {
      item.refunded = true;
      order.amounts.balanceDue = refund.balanceDue;
      if (refund.amount > 0) {
        order.amounts.refunded += refund.amount;
        order.refunds.push({ itemId: item._id, amount: refund.amount, providerRefundId: refund.refundId, status: refund.status });
      }
      const anyLeft = order.items.some((i) => i.status !== 'cancelled');
      // Fully refunded once nothing is left; fully paid when the advance alone now covers what's left.
      if (!anyLeft) order.payment.status = order.amounts.refunded > 0 ? 'refunded' : order.payment.status;
      else if (refund.balanceDue === 0) order.payment.status = 'paid';
    } else if (refund) {
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
    // Partial: the courier collected the balance with the last delivery.
    if (order.payment.method === 'partial' && order.status === 'completed' && order.payment.status === 'partially_paid') {
      order.payment.status = 'paid';
      order.amounts.balanceDue = 0;
    }

    await order.save();
    if (changingStatus && status === 'cancelled') await releaseStock([stockLine(item)]);
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
    return {
      items: rows.map((o) => serializeVendorOrder(o, vendorId)),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
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
    const order = await Order.findById(id)
      .populate('user', 'name phone email')
      .populate('items.vendor', 'store.name store.slug phone isPlatform')
      .lean();
    if (!order) throw ApiError.notFound('Order not found');
    // user and items.vendor are populated, and the serializer passes them through.
    return serializeOrder(order);
  },

  serializeOrder,
  serializeVendorOrder,
};
