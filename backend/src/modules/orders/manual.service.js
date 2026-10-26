import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';
import { withLock } from '#core/utils/lock.js';
import { gstFromInclusive } from '#core/utils/money.js';
import { resolveSellable } from '#modules/products/inventory.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { paymentService } from '#services/payment/payment.service.js';
import { Order } from './order.model.js';
import { newOrderNumber, orderService, releaseStock, reserveStock, stockLine } from './order.service.js';
import { serializeOrder } from './order.serializer.js';
import { ORDER_LINK_DAYS, OrderLink } from './orderLink.model.js';
import { allocate } from './partialPayment.js';

const PRODUCT_FIELDS = 'name slug type images pricing inventory hsnCode sku vendor status vendorApproved variantOptions variants';

/** An existing customer by mobile, or a new account for them (they can sign in with an OTP to that number later). */
async function customerFor({ userId, phone, name }) {
  if (userId) {
    const user = await User.findById(userId);
    if (!user) throw ApiError.notFound('Customer not found');
    return user;
  }
  const existing = await User.findOne({ phone });
  if (existing) return existing;
  try {
    return await User.create({ phone, name });
  } catch (err) {
    if (err?.code === 11000) return User.findOne({ phone });
    throw err;
  }
}

/**
 * Prices the panel's items (list price unless the panel set its own) and splits the discount over the lines,
 * like a coupon. A seller can only add their own products.
 */
async function priceItems(items, { vendorId, discount = 0, shipping = 0 }) {
  const products = await Product.find({ _id: { $in: items.map((i) => i.product) }, ...VISIBLE })
    .select(PRODUCT_FIELDS)
    .lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const priced = items.map((input) => {
    const p = byId.get(String(input.product));
    if (!p || (vendorId && String(p.vendor) !== String(vendorId))) {
      throw ApiError.unprocessable('A product on this order is not available', { code: 'PRODUCT_UNAVAILABLE', details: { product: input.product } });
    }
    if (p.pricing.gstRate == null) throw ApiError.unprocessable(`Set a GST rate on ${p.name} first`, { code: 'GST_MISSING' });
    const sellable = resolveSellable(p, input.variant);
    const unitPrice = input.unitPrice ?? sellable.price;
    return { input, p, sellable, unitPrice, gross: unitPrice * input.quantity };
  });

  const subtotal = priced.reduce((s, l) => s + l.gross, 0);
  if (discount > subtotal) throw ApiError.unprocessable('The discount is more than the order value', { code: 'DISCOUNT_TOO_HIGH' });
  const shares = allocate(discount, priced.map((l) => l.gross));
  return {
    priced: priced.map((l, k) => ({ ...l, discount: shares[k] })),
    amounts: { subtotal, discount, shipping, total: subtotal - discount + shipping },
  };
}

/** Order lines in the same shape checkout writes. */
function orderLines(priced, actor) {
  return priced.map(({ input, p, sellable, unitPrice, gross, discount }) => ({
    product: p._id,
    vendor: p.vendor,
    name: p.name,
    slug: p.slug,
    sku: sellable.sku,
    ...(sellable.variant ? { variant: { id: sellable.variant._id, title: sellable.title } } : {}),
    stockTracked: p.inventory?.trackQuantity !== false,
    image: sellable.image,
    type: p.type,
    hsnCode: p.hsnCode,
    unitPrice,
    basePrice: sellable.price,
    unitMrp: Math.max(sellable.mrp, unitPrice),
    pricing: { source: 'base' },
    gstRate: p.pricing.gstRate,
    quantity: input.quantity,
    lineTotal: gross - discount,
    discount,
    taxAmount: gstFromInclusive(gross - discount, p.pricing.gstRate),
    status: 'pending',
    history: [{ status: 'pending', by: actor }],
  }));
}

/** Reserves stock and writes the order; gives the stock back if the write fails. */
async function writeOrder({ lines, user, address, amounts, notes, payment, status, source, actor, link, expiresAt }) {
  await reserveStock(lines);
  try {
    return await Order.create({
      _id: new mongoose.Types.ObjectId(),
      orderNumber: newOrderNumber(),
      user: user._id,
      items: lines,
      vendors: [...new Set(lines.map((l) => String(l.vendor)))],
      shippingAddress: address,
      billing: { name: user.name, businessName: user.business?.name, gstin: user.business?.gstin },
      notes,
      amounts: { ...amounts, tax: lines.reduce((s, l) => s + l.taxAmount, 0) },
      payment,
      status,
      source,
      createdBy: actor,
      link,
      expiresAt,
    });
  } catch (err) {
    await releaseStock(lines);
    throw err;
  }
}

const pickAddress = (a) => ({
  name: a.name,
  phone: a.phone,
  line1: a.line1,
  line2: a.line2,
  landmark: a.landmark,
  city: a.city,
  state: a.state,
  pincode: a.pincode,
});

const linkUrl = (token) => `${env.PUBLIC_APP_URL}/pay/${token}`;

function linkState(link, now = new Date()) {
  return link.status === 'open' && link.expiresAt <= now ? 'expired' : link.status;
}

function serializeLink(link) {
  return {
    _id: link._id,
    url: linkUrl(link.token),
    status: linkState(link),
    customer: link.user?.name ? { _id: link.user._id, name: link.user.name, phone: link.user.phone } : { _id: link.user },
    shippingAddress: link.shippingAddress,
    items: link.items.map((i) => ({
      product: i.product,
      name: i.name,
      image: i.image ?? null,
      variant: i.variant?.title ?? null,
      unitPrice: i.unitPrice,
      quantity: i.quantity,
    })),
    amounts: link.amounts,
    notes: link.notes ?? null,
    expiresAt: link.expiresAt,
    paidAt: link.paidAt ?? null,
    order: link.order?.orderNumber ? { _id: link.order._id, orderNumber: link.order.orderNumber, status: link.order.status } : null,
    createdAt: link.createdAt,
  };
}

/** What the customer sees on the pay page: no ids beyond what they need, phone partly hidden. */
async function serializePublicLink(link) {
  const vendors = await Vendor.find({ _id: { $in: [...new Set(link.items.map((i) => String(i.vendor)))] } })
    .select('store.name')
    .lean();
  const phone = link.shippingAddress.phone;
  return {
    status: linkState(link),
    sellers: vendors.map((v) => v.store.name),
    customerName: link.user?.name ?? link.shippingAddress.name,
    shippingAddress: { ...pickAddress(link.shippingAddress), phone: phone.replace(/\d(?=\d{4})/g, '•') },
    items: link.items.map((i) => ({ name: i.name, image: i.image ?? null, variant: i.variant?.title ?? null, unitPrice: i.unitPrice, quantity: i.quantity })),
    amounts: link.amounts,
    notes: link.notes ?? null,
    expiresAt: link.expiresAt,
    orderNumber: link.status === 'paid' ? (link.order?.orderNumber ?? null) : null,
  };
}

async function openLink(token) {
  const link = await OrderLink.findOne({ token }).populate('user', 'name phone email').populate('order', 'orderNumber status');
  if (!link) throw ApiError.notFound('This payment link is not valid');
  return link;
}

/**
 * Orders entered from the admin panel, a seller panel or the house store:
 *  - create: the order is placed straight away (cash on delivery, or already paid offline)
 *  - share:  a payment link the customer opens and pays online; the order is placed when they pay
 */
export const manualOrderService = {
  /** Saved name and addresses for a mobile number, so the panel can fill the form. */
  async lookupCustomer(phone) {
    const user = await User.findOne({ phone }).select('name phone addresses').lean();
    if (!user) return { found: false };
    return { found: true, _id: user._id, name: user.name, phone: user.phone, addresses: (user.addresses ?? []).map(pickAddress) };
  },

  /**
   * @param {{ kind: string, id: any }} actor
   * @param {{ vendorId?: any }} scope  sellers (and the house store) are limited to their own products
   */
  async create(input, actor, { vendorId } = {}) {
    if (input.mode === 'share') await paymentService.requireOnlineProvider();
    const user = await customerFor(input.customer);
    const address = pickAddress({ ...input.address, name: input.address.name ?? user.name, phone: input.address.phone ?? user.phone });
    const { priced, amounts } = await priceItems(input.items, { vendorId, discount: input.discount, shipping: input.deliveryFee });

    if (input.mode === 'share') {
      const days = input.validDays ?? ORDER_LINK_DAYS.default;
      const link = await OrderLink.create({
        token: crypto.randomBytes(18).toString('base64url'),
        createdBy: actor,
        vendor: vendorId,
        user: user._id,
        shippingAddress: address,
        items: priced.map(({ input: i, p, sellable, unitPrice }) => ({
          product: p._id,
          vendor: p.vendor,
          ...(sellable.variant ? { variant: { id: sellable.variant._id, title: sellable.title } } : {}),
          name: p.name,
          image: sellable.image,
          unitPrice,
          quantity: i.quantity,
        })),
        amounts,
        notes: input.notes,
        expiresAt: new Date(Date.now() + days * 86_400_000),
      });
      await link.populate('user', 'name phone');
      return { link: serializeLink(link) };
    }

    const paid = input.paymentMethod === 'offline';
    const order = await writeOrder({
      lines: orderLines(priced, actor),
      user,
      address,
      amounts,
      notes: input.notes,
      payment: { method: input.paymentMethod, status: paid ? 'paid' : 'pending', ...(paid ? { paidAt: new Date() } : {}) },
      status: 'placed',
      source: 'manual',
      actor,
    });
    return { order: serializeOrder(order) };
  },

  async listLinks({ vendorId, page, limit, status }) {
    const filter = vendorId ? { vendor: vendorId } : {};
    const now = new Date();
    if (status === 'expired') Object.assign(filter, { status: 'open', expiresAt: { $lte: now } });
    else if (status === 'open') Object.assign(filter, { status: 'open', expiresAt: { $gt: now } });
    else if (status) filter.status = status;
    const [rows, total] = await Promise.all([
      OrderLink.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name phone')
        .populate('order', 'orderNumber status')
        .lean(),
      OrderLink.countDocuments(filter),
    ]);
    return { items: rows.map(serializeLink), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async cancelLink(id, { vendorId } = {}) {
    const link = await OrderLink.findOneAndUpdate(
      { _id: id, ...(vendorId ? { vendor: vendorId } : {}), status: 'open' },
      { status: 'cancelled' },
      { returnDocument: 'after' },
    )
      .populate('user', 'name phone')
      .populate('order', 'orderNumber status');
    if (!link) throw ApiError.conflict('Only an unpaid link can be cancelled', { code: 'LINK_NOT_OPEN' });
    return serializeLink(link);
  },

  /* ─────────────────────────── The customer's side (no sign-in) ─────────────────────────── */

  async publicView(token) {
    return serializePublicLink(await openLink(token));
  },

  /** Starts (or resumes) payment: the order is written, stock taken and a gateway order opened. One at a time per link. */
  startPayment(token) {
    return withLock(`order-link:${token}`, () => this.openPayment(token), { waitMs: 10_000 });
  },

  async openPayment(token) {
    const link = await openLink(token);
    const state = linkState(link);
    if (state !== 'open') {
      throw ApiError.conflict(state === 'paid' ? 'This order is already paid' : `This payment link is ${state}`, { code: 'LINK_NOT_OPEN' });
    }
    const user = link.user;

    // A payment already under way (another tab, or a retry) carries on with the same order.
    if (link.order?.status === 'pending_payment') {
      const pending = await Order.findById(link.order._id);
      if (pending.expiresAt > new Date()) {
        const { checkoutPayload } = await paymentService.createOrReusePaymentAttempt(pending, user);
        return { orderId: pending._id, payment: checkoutPayload };
      }
    }

    const { priced, amounts } = await priceItems(
      link.items.map((i) => ({ product: i.product, variant: i.variant?.id, quantity: i.quantity, unitPrice: i.unitPrice })),
      { discount: link.amounts.discount, shipping: link.amounts.shipping },
    );
    const order = await writeOrder({
      lines: orderLines(priced, link.createdBy),
      user,
      address: pickAddress(link.shippingAddress),
      amounts,
      notes: link.notes,
      payment: { method: 'razorpay', status: 'pending', provider: 'razorpay' },
      status: 'pending_payment',
      source: 'link',
      actor: link.createdBy,
      link: link._id,
      expiresAt: new Date(Date.now() + env.ORDER_PAYMENT_WINDOW_MINUTES * 60_000),
    });
    link.order = order._id;
    await link.save();

    try {
      const { checkoutPayload } = await paymentService.createOrReusePaymentAttempt(order, user);
      return { orderId: order._id, payment: checkoutPayload };
    } catch (err) {
      await Order.updateOne(
        { _id: order._id },
        { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'Payment could not be started', 'items.$[].status': 'cancelled' },
      );
      await releaseStock(order.items.map(stockLine));
      throw err;
    }
  },

  async verifyPayment(token, body) {
    const link = await openLink(token);
    if (!link.order) throw ApiError.conflict('No payment has been started for this link', { code: 'NO_PAYMENT' });
    await orderService.verifyPayment(link.user, link.order._id, body);
    return serializePublicLink(await openLink(token));
  },

  async paymentFailed(token, reason) {
    const link = await openLink(token);
    if (link.order) await orderService.recordPaymentFailure(link.user, link.order._id, reason);
  },
};
