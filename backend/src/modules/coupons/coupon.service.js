import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex } from '#core/utils/strings.js';
import { allocate } from '#modules/orders/partialPayment.js';
import { Coupon, CouponRedemption, MAX_PERCENT_OFF } from './coupon.model.js';

/** Why a coupon can't be used right now, in words a buyer understands. */
const ISSUE_MESSAGES = {
  inactive: 'This coupon is no longer available',
  not_started: 'This coupon is not active yet',
  expired: 'This coupon has expired',
  no_items: "This coupon is for another seller's products",
  below_min: 'Add more items from this seller to use this coupon',
  limit_reached: 'This coupon has been fully redeemed',
  already_used: "You've already used this coupon",
};

export const couponIssueMessage = (issue, coupon) =>
  issue === 'below_min' && coupon
    ? `Shop for ₹${(coupon.minOrderValue / 100).toLocaleString('en-IN')} or more from this seller to use this coupon`
    : ISSUE_MESSAGES[issue];

/** Discount (paise) a coupon gives on `eligibleTotal`, never more than the total itself. */
export function discountFor(coupon, eligibleTotal) {
  const raw = coupon.type === 'percent' ? Math.floor((eligibleTotal * coupon.value) / 100) : coupon.value;
  const capped = coupon.type === 'percent' && coupon.maxDiscount ? Math.min(raw, coupon.maxDiscount) : raw;
  return Math.max(0, Math.min(capped, eligibleTotal));
}

/** Time-based state shared by evaluation and listings. */
function timeIssue(coupon, now) {
  if (!coupon.active) return 'inactive';
  if (coupon.startsAt && coupon.startsAt > now) return 'not_started';
  if (coupon.expiresAt && coupon.expiresAt <= now) return 'expired';
  if (coupon.usageLimit && coupon.usedCount >= coupon.usageLimit) return 'limit_reached';
  return null;
}

function assertConsistent(c) {
  const fail = (path, message) => {
    throw ApiError.unprocessable('Validation failed', { details: [{ path, message }] });
  };
  if (c.type === 'percent' && c.value > MAX_PERCENT_OFF) fail('value', `At most ${MAX_PERCENT_OFF}% off`);
  if (c.type === 'flat' && c.maxDiscount) fail('maxDiscount', 'Only for percentage coupons');
  if (c.startsAt && c.expiresAt && c.expiresAt <= c.startsAt) fail('expiresAt', 'Must be after the start date');
}

function serializeCoupon(c, now = new Date()) {
  return {
    _id: c._id,
    code: c.code,
    description: c.description ?? null,
    type: c.type,
    value: c.value,
    maxDiscount: c.maxDiscount ?? null,
    minOrderValue: c.minOrderValue ?? 0,
    startsAt: c.startsAt ?? null,
    expiresAt: c.expiresAt ?? null,
    usageLimit: c.usageLimit ?? null,
    perUserLimit: c.perUserLimit ?? 1,
    usedCount: c.usedCount ?? 0,
    active: c.active,
    // What a seller sees at a glance: live, scheduled, expired, used up or switched off.
    state: timeIssue(c, now) ?? 'live',
    createdAt: c.createdAt,
  };
}

/** Optional fields cleared with null are unset rather than stored as null. */
function toUpdate(input) {
  const $set = {};
  const $unset = {};
  for (const [k, v] of Object.entries(input)) {
    if (v === null) $unset[k] = 1;
    else if (v !== undefined) $set[k] = v;
  }
  return { $set, $unset };
}

const duplicateCode = (err) => {
  if (err?.code === 11000) {
    throw ApiError.conflict('This code is already taken. Try another one.', {
      code: 'DUPLICATE_CODE',
      details: [{ path: 'code', message: 'Already taken' }],
    });
  }
  throw err;
};

export const couponService = {
  ISSUE_MESSAGES,

  /* ─────────────────────────── Seller ─────────────────────────── */

  async list(vendorId, { page, limit, status, q }) {
    const now = new Date();
    const filter = { vendor: vendorId };
    if (q) filter.code = new RegExp(escapeRegex(q.toUpperCase()));
    if (status === 'inactive') filter.active = false;
    if (status === 'active') filter.active = true;
    if (status === 'expired') filter.expiresAt = { $lte: now };
    if (status === 'usable') {
      Object.assign(filter, {
        active: true,
        $and: [
          { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
          { $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] },
          { $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }] },
        ],
      });
    }
    const [rows, total] = await Promise.all([
      Coupon.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Coupon.countDocuments(filter),
    ]);
    return {
      items: rows.map((c) => serializeCoupon(c, now)),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async get(vendorId, id) {
    const coupon = await Coupon.findOne({ _id: id, vendor: vendorId }).lean();
    if (!coupon) throw ApiError.notFound('Coupon not found');
    return serializeCoupon(coupon);
  },

  /** A seller's own coupon, as a document (for sharing with a lead). */
  async usableForVendor(vendorId, id) {
    const coupon = await Coupon.findOne({ _id: id, vendor: vendorId }).lean();
    if (!coupon) throw ApiError.notFound('Coupon not found');
    const issue = timeIssue(coupon, new Date());
    if (issue && issue !== 'not_started') throw ApiError.conflict(couponIssueMessage(issue), { code: 'COUPON_UNUSABLE' });
    return coupon;
  },

  async create(vendorId, input) {
    assertConsistent(input);
    const { $set } = toUpdate(input);
    const coupon = await Coupon.create({ ...$set, vendor: vendorId }).catch(duplicateCode);
    return serializeCoupon(coupon.toObject());
  },

  async update(vendorId, id, input) {
    const coupon = await Coupon.findOne({ _id: id, vendor: vendorId }).lean();
    if (!coupon) throw ApiError.notFound('Coupon not found');
    // Buyers may already hold a redeemed code; changing what it means afterwards isn't fair to them.
    if (coupon.usedCount > 0 && ['code', 'type', 'value'].some((k) => input[k] !== undefined && input[k] !== coupon[k])) {
      throw ApiError.conflict('This coupon has been used. Create a new one to change its code or discount.', { code: 'COUPON_IN_USE' });
    }
    // A flat coupon has no cap: switching to flat drops one left over from a percentage coupon.
    if (input.type === 'flat' && input.maxDiscount === undefined && coupon.maxDiscount) input.maxDiscount = null;
    const merged = { ...coupon };
    for (const [k, v] of Object.entries(input)) merged[k] = v ?? undefined;
    assertConsistent(merged);
    const { $set, $unset } = toUpdate(input);
    const updated = await Coupon.findOneAndUpdate(
      { _id: id, vendor: vendorId },
      { ...(Object.keys($set).length ? { $set } : {}), ...(Object.keys($unset).length ? { $unset } : {}) },
      { returnDocument: 'after' },
    )
      .lean()
      .catch(duplicateCode);
    return serializeCoupon(updated);
  },

  /** Unused coupons are deleted; used ones are switched off so past orders keep their record. */
  async remove(vendorId, id) {
    const coupon = await Coupon.findOne({ _id: id, vendor: vendorId }).lean();
    if (!coupon) throw ApiError.notFound('Coupon not found');
    if (coupon.usedCount > 0 || (await CouponRedemption.exists({ coupon: coupon._id }))) {
      await Coupon.updateOne({ _id: coupon._id }, { active: false });
      return { deleted: false, deactivated: true };
    }
    await Coupon.deleteOne({ _id: coupon._id });
    return { deleted: true, deactivated: false };
  },

  /* ─────────────────────────── Buyer (cart / checkout) ─────────────────────────── */

  findByCode(code) {
    return Coupon.findOne({ code: String(code).trim().toUpperCase() }).lean();
  },

  /**
   * What `coupon` does for this buyer's priced cart lines.
   * Eligible lines: the coupon seller's, without problems, not priced by a quote.
   * @param {Array<{ vendor: any, lineTotal: number, issue?: string|null, pricing: { source: string } }>} items
   * @returns {Promise<{ discount: number, shares: number[], eligibleTotal: number, issue: string|null }>} shares[i] is items[i]'s part
   */
  async evaluate(coupon, { userId, items, now = new Date() }) {
    const none = (issue, eligibleTotal = 0) => ({ discount: 0, shares: items.map(() => 0), eligibleTotal, issue });
    if (!coupon) return none('inactive');
    const time = timeIssue(coupon, now);
    if (time) return none(time);

    const eligible = items.map((i) => !i.issue && i.pricing?.source !== 'quote' && String(i.vendor) === String(coupon.vendor));
    const eligibleTotal = items.reduce((s, i, k) => (eligible[k] ? s + i.lineTotal : s), 0);
    if (!eligibleTotal) return none('no_items');
    if (eligibleTotal < (coupon.minOrderValue ?? 0)) return none('below_min', eligibleTotal);

    const used = await CouponRedemption.countDocuments({ coupon: coupon._id, user: userId, status: 'active' });
    if (used >= (coupon.perUserLimit ?? 1)) return none('already_used', eligibleTotal);

    const discount = discountFor(coupon, eligibleTotal);
    // Spread exactly over the eligible lines (largest remainder), so refunds per line add up to the paisa.
    const weights = items.map((i, k) => (eligible[k] ? i.lineTotal : 0));
    return { discount, shares: allocate(discount, weights), eligibleTotal, issue: null };
  },

  /**
   * Takes one use of the coupon for `orderId`. The global limit is enforced atomically; the
   * per-buyer limit was checked in evaluate() under the buyer's checkout lock.
   */
  async redeem(coupon, { userId, orderId, discount }) {
    const claimed = await Coupon.updateOne(
      {
        _id: coupon._id,
        active: true,
        $or: [{ usageLimit: null }, { usageLimit: { $exists: false } }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
      },
      { $inc: { usedCount: 1 } },
    );
    if (!claimed.modifiedCount) {
      throw ApiError.conflict(ISSUE_MESSAGES.limit_reached, { code: 'COUPON_INVALID', details: { issue: 'limit_reached' } });
    }
    await CouponRedemption.create({ coupon: coupon._id, user: userId, order: orderId, discount });
  },

  /** The order never completed (payment failed / timed out): give the use back. */
  async releaseForOrder(order) {
    if (!order.coupon?.id) return;
    const released = await CouponRedemption.findOneAndUpdate(
      { coupon: order.coupon.id, order: order._id, status: 'active' },
      { status: 'released' },
    );
    if (released) await Coupon.updateOne({ _id: order.coupon.id, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
  },

  /** A late payment revived an expired order: it keeps its discount, so it takes its use back (limits aside). */
  async reclaimForOrder(order) {
    if (!order.coupon?.id) return;
    const revived = await CouponRedemption.findOneAndUpdate(
      { coupon: order.coupon.id, order: order._id, status: 'released' },
      { status: 'active' },
    );
    if (revived) await Coupon.updateOne({ _id: order.coupon.id }, { $inc: { usedCount: 1 } });
  },

  serializeCoupon,
};
