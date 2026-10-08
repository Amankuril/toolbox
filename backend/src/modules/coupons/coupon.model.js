import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

export const COUPON_TYPES = ['percent', 'flat'];
export const MAX_PERCENT_OFF = 90;

/**
 * A seller's coupon code. It discounts only that seller's lines in a cart (never quote-priced lines,
 * which were already negotiated). Codes are unique across the marketplace, so a buyer never has to
 * say which seller a code belongs to. All money in paise.
 */
const couponSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    code: { type: String, required: true, trim: true, uppercase: true, maxlength: 20 },
    description: { type: String, trim: true, maxlength: 200 },
    type: { type: String, enum: COUPON_TYPES, required: true },
    // percent: 1–90; flat: paise.
    value: { type: Number, required: true, min: 1 },
    // percent coupons only: the most it can take off, in paise.
    maxDiscount: { type: Number, min: 1 },
    // On the seller's eligible lines, before the discount.
    minOrderValue: { type: Number, min: 0, default: 0 },
    startsAt: { type: Date },
    expiresAt: { type: Date },
    // Total redemptions allowed (unset = unlimited) and per buyer.
    usageLimit: { type: Number, min: 1 },
    perUserLimit: { type: Number, min: 1, default: 1 },
    usedCount: { type: Number, min: 0, default: 0 },
    active: { type: Boolean, default: true },
  },
  baseOptions,
);

couponSchema.index({ code: 1 }, { unique: true });
couponSchema.index({ vendor: 1, createdAt: -1 });

export const Coupon = mongoose.models.Coupon ?? mongoose.model('Coupon', couponSchema);

/** One use of a coupon by an order. Released (and the use given back) if the order never completes. */
const redemptionSchema = new Schema(
  {
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    discount: { type: Number, required: true, min: 0 },
    status: { type: String, enum: ['active', 'released'], default: 'active' },
  },
  baseOptions,
);

redemptionSchema.index({ coupon: 1, order: 1 }, { unique: true });
redemptionSchema.index({ coupon: 1, user: 1, status: 1 });

export const CouponRedemption = mongoose.models.CouponRedemption ?? mongoose.model('CouponRedemption', redemptionSchema);
