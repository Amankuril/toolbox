import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex } from '#core/utils/strings.js';
import { cartService } from '#modules/cart/cart.service.js';
import { quoteThreshold } from '#modules/products/pricing.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { Quote, OPEN_QUOTE_STATUSES, QUOTE_STATUSES } from './quote.model.js';

const DAY = 24 * 60 * 60 * 1000;

function newQuoteNumber() {
  const d = new Date();
  const ymd = `${String(d.getUTCFullYear()).slice(2)}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  return `RFQ${ymd}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** Offers past their validity read as expired even before the job flips them. */
function effectiveStatus(q) {
  if (['quoted', 'accepted'].includes(q.status) && q.offer?.validUntil && new Date(q.offer.validUntil) <= new Date()) return 'expired';
  return q.status;
}

function base(q) {
  return {
    _id: q._id,
    number: q.number,
    status: effectiveStatus(q),
    product: { _id: q.product?._id ?? q.product, ...q.productSnapshot },
    quantity: q.quantity,
    targetUnitPrice: q.targetUnitPrice ?? null,
    requiredBy: q.requiredBy ?? null,
    pincode: q.pincode,
    note: q.note ?? null,
    offer: q.offer?.quotedAt ? { unitPrice: q.offer.unitPrice, validUntil: q.offer.validUntil, note: q.offer.note ?? null, quotedAt: q.offer.quotedAt, revision: q.offer.revision } : null,
    declineReason: q.declineReason ?? null,
    order: q.order ?? null,
    history: q.history ?? [],
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

export function serializeQuoteForBuyer(q) {
  return { ...base(q), vendor: q.vendor?.store ? { _id: q.vendor._id, store: { name: q.vendor.store.name, slug: q.vendor.store.slug } } : null };
}

/** Vendors see who is asking (name, business, GSTIN, pincode) but not their phone: the conversation stays on-platform. */
export function serializeQuoteForVendor(q) {
  const u = q.user;
  return {
    ...base(q),
    buyer: u?.name
      ? { name: u.name, accountType: u.accountType, businessName: u.business?.name ?? null, gstin: u.business?.gstin ?? null }
      : null,
  };
}

export function serializeQuoteForAdmin(q) {
  return { ...serializeQuoteForVendor(q), vendor: serializeQuoteForBuyer(q).vendor };
}

async function counts(match) {
  const rows = await Quote.aggregate([{ $match: match }, { $group: { _id: '$status', count: { $sum: 1 } } }]);
  return Object.fromEntries(rows.map((r) => [r._id, r.count]));
}

function statusFilter(status) {
  if (!status) return {};
  // "expired" also covers offers whose validity passed before the job ran.
  if (status === 'expired') return { $or: [{ status: 'expired' }, { status: { $in: ['quoted', 'accepted'] }, 'offer.validUntil': { $lte: new Date() } }] };
  if (['quoted', 'accepted'].includes(status)) return { status, 'offer.validUntil': { $gt: new Date() } };
  return { status };
}

async function page(filter, { page: p, limit }, populate) {
  let query = Quote.find(filter)
    .sort({ updatedAt: -1 })
    .skip((p - 1) * limit)
    .limit(limit);
  for (const [path, select] of populate) query = query.populate(path, select);
  const [rows, total] = await Promise.all([query.lean(), Quote.countDocuments(filter)]);
  return { rows, meta: { page: p, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

function assertStatus(quote, allowed, message) {
  const status = effectiveStatus(quote);
  if (status === 'expired' && !allowed.includes('expired')) throw ApiError.conflict('This quote has expired', { code: 'QUOTE_EXPIRED' });
  if (!allowed.includes(status)) throw ApiError.conflict(message ?? `This quote is ${status}`, { code: 'INVALID_QUOTE_STATUS' });
}

function push(quote, status, by, note) {
  quote.status = status;
  quote.history.push({ status, by, note, at: new Date() });
}

const BUYER_POPULATE = [['vendor', 'store.name store.slug']];
const VENDOR_POPULATE = [['user', 'name accountType business']];

export const quoteService = {
  /* ─────────────────────────── Buyer ─────────────────────────── */

  async request(user, { productId, quantity, targetUnitPrice, requiredBy, pincode, note }) {
    const product = await Product.findOne({ _id: productId, ...VISIBLE }).lean();
    if (!product) throw ApiError.notFound('This product is no longer available', { code: 'PRODUCT_UNAVAILABLE' });
    if (product.quotes?.enabled === false) throw ApiError.unprocessable('The seller is not taking quote requests for this item', { code: 'QUOTES_DISABLED' });

    const threshold = quoteThreshold(product);
    if (quantity < threshold) {
      throw ApiError.unprocessable(`Quotes are for ${threshold} units or more. Use the listed bulk prices for smaller quantities.`, {
        code: 'BELOW_QUOTE_THRESHOLD',
        details: [{ path: 'quantity', message: `At least ${threshold}` }],
      });
    }
    if (targetUnitPrice && targetUnitPrice >= product.pricing.price) {
      throw ApiError.unprocessable('Your target price should be below the listed price', {
        details: [{ path: 'targetUnitPrice', message: 'Must be below the listed price' }],
      });
    }

    const open = await Quote.findOne({ user: user._id, product: product._id, status: { $in: OPEN_QUOTE_STATUSES } })
      .select('_id number status offer')
      .lean();
    if (open && effectiveStatus(open) !== 'expired') {
      throw ApiError.conflict(`You already have an open quote (${open.number}) for this item`, { code: 'QUOTE_ALREADY_OPEN', details: { quoteId: open._id } });
    }

    const quote = await Quote.create({
      number: newQuoteNumber(),
      product: product._id,
      vendor: product.vendor,
      user: user._id,
      productSnapshot: {
        name: product.name,
        slug: product.slug,
        image: product.images?.[0]?.url,
        sku: product.sku,
        unit: product.inventory.unit,
        basePrice: product.pricing.price,
        gstRate: product.pricing.gstRate,
      },
      quantity,
      targetUnitPrice,
      requiredBy,
      pincode,
      note,
      history: [{ status: 'requested', by: { kind: 'user', id: user._id } }],
    });
    return serializeQuoteForBuyer(quote.toObject());
  },

  async listForBuyer(userId, { page: p, limit, status }) {
    const scope = { user: new mongoose.Types.ObjectId(String(userId)) };
    const [{ rows, meta }, byStatus] = await Promise.all([page({ ...scope, ...statusFilter(status) }, { page: p, limit }, BUYER_POPULATE), counts(scope)]);
    return { items: rows.map(serializeQuoteForBuyer), meta: { ...meta, counts: byStatus } };
  },

  async getForBuyer(userId, id) {
    const quote = await Quote.findOne({ _id: id, user: userId }).populate('vendor', 'store.name store.slug').lean();
    if (!quote) throw ApiError.notFound('Quote not found');
    return serializeQuoteForBuyer(quote);
  },

  /** Accepts an offer (or re-adds an accepted one) and puts it in the cart at the quoted price. */
  async accept(user, id) {
    const quote = await Quote.findOne({ _id: id, user: user._id });
    if (!quote) throw ApiError.notFound('Quote not found');
    assertStatus(quote, ['quoted', 'accepted'], 'Only an active offer can be accepted');
    if (quote.status === 'quoted') {
      push(quote, 'accepted', { kind: 'user', id: user._id });
      await quote.save();
    }
    const cart = await cartService.addQuote(user._id, quote);
    return { quote: serializeQuoteForBuyer(quote.toObject()), cart };
  },

  async reject(user, id, { reason }) {
    const quote = await Quote.findOne({ _id: id, user: user._id });
    if (!quote) throw ApiError.notFound('Quote not found');
    assertStatus(quote, ['quoted'], 'Only an offer can be declined');
    push(quote, 'rejected', { kind: 'user', id: user._id }, reason);
    await quote.save();
    return serializeQuoteForBuyer(quote.toObject());
  },

  async withdraw(user, id) {
    const quote = await Quote.findOne({ _id: id, user: user._id });
    if (!quote) throw ApiError.notFound('Quote not found');
    assertStatus(quote, ['requested', 'quoted', 'accepted'], 'This request can no longer be withdrawn');
    push(quote, 'withdrawn', { kind: 'user', id: user._id });
    await quote.save();
    await cartService.removeQuotes([quote._id]);
    return serializeQuoteForBuyer(quote.toObject());
  },

  /* ─────────────────────────── Vendor ─────────────────────────── */

  async listForVendor(vendorId, { page: p, limit, status, q }) {
    const scope = { vendor: new mongoose.Types.ObjectId(String(vendorId)) };
    const filter = { ...scope, ...statusFilter(status) };
    if (q) filter.$and = [{ $or: [{ number: new RegExp(escapeRegex(q), 'i') }, { 'productSnapshot.name': new RegExp(escapeRegex(q), 'i') }] }];
    const [{ rows, meta }, byStatus] = await Promise.all([page(filter, { page: p, limit }, VENDOR_POPULATE), counts(scope)]);
    return { items: rows.map(serializeQuoteForVendor), meta: { ...meta, counts: byStatus } };
  },

  async getForVendor(vendorId, id) {
    const quote = await Quote.findOne({ _id: id, vendor: vendorId }).populate('user', 'name accountType business').lean();
    if (!quote) throw ApiError.notFound('Quote not found');
    return serializeQuoteForVendor(quote);
  },

  /** Sends (or revises) an offer. Revising is allowed until the buyer accepts. */
  async sendOffer(vendorId, id, { unitPrice, validDays, note }) {
    const quote = await Quote.findOne({ _id: id, vendor: vendorId });
    if (!quote) throw ApiError.notFound('Quote not found');
    // Offers can be revised until accepted, and re-issued after they lapse.
    assertStatus(quote, ['requested', 'quoted', 'expired'], 'This request can no longer be quoted');
    const revision = quote.offer?.quotedAt ? (quote.offer.revision ?? 0) + 1 : 0;
    quote.offer = { unitPrice, validUntil: new Date(Date.now() + validDays * DAY), note, quotedAt: new Date(), revision };
    push(quote, 'quoted', { kind: 'vendor', id: vendorId }, revision ? `Revised offer #${revision}` : undefined);
    await quote.save();
    await quote.populate('user', 'name accountType business');
    return serializeQuoteForVendor(quote.toObject());
  },

  async decline(vendorId, id, { reason }) {
    const quote = await Quote.findOne({ _id: id, vendor: vendorId });
    if (!quote) throw ApiError.notFound('Quote not found');
    assertStatus(quote, ['requested', 'quoted'], 'This request can no longer be declined');
    quote.declineReason = reason;
    push(quote, 'declined', { kind: 'vendor', id: vendorId }, reason);
    await quote.save();
    await quote.populate('user', 'name accountType business');
    return serializeQuoteForVendor(quote.toObject());
  },

  /* ─────────────────────────── Admin ─────────────────────────── */

  async listForAdmin({ page: p, limit, status, vendor, q }) {
    const filter = { ...statusFilter(status) };
    if (vendor) filter.vendor = new mongoose.Types.ObjectId(String(vendor));
    if (q) filter.$and = [{ $or: [{ number: new RegExp(escapeRegex(q), 'i') }, { 'productSnapshot.name': new RegExp(escapeRegex(q), 'i') }] }];
    const [{ rows, meta }, byStatus] = await Promise.all([
      page(filter, { page: p, limit }, [...BUYER_POPULATE, ...VENDOR_POPULATE]),
      counts(vendor ? { vendor: filter.vendor } : {}),
    ]);
    return { items: rows.map(serializeQuoteForAdmin), meta: { ...meta, counts: byStatus } };
  },

  async getForAdmin(id) {
    const quote = await Quote.findById(id).populate('vendor', 'store.name store.slug').populate('user', 'name accountType business').lean();
    if (!quote) throw ApiError.notFound('Quote not found');
    return serializeQuoteForAdmin(quote);
  },

  STATUSES: QUOTE_STATUSES,
};
