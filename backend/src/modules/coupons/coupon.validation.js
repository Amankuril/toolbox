import { z } from 'zod';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams, optionalText } from '#core/validation/common.js';
import { COUPON_TYPES, MAX_PERCENT_OFF } from './coupon.model.js';

const money = z.number().int('Amount must be in paise').min(1).max(1_000_000_000);

export const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,19}$/, 'Use 3–20 letters, numbers, - or _');

const fields = {
  code: couponCode,
  description: optionalText(200),
  type: z.enum(COUPON_TYPES),
  value: z.number().int().min(1),
  maxDiscount: money.nullable().optional(),
  minOrderValue: z.number().int().min(0).max(1_000_000_000).default(0),
  startsAt: z.coerce.date().nullable().optional(),
  expiresAt: z.coerce.date().nullable().optional(),
  usageLimit: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).default(1),
  active: z.boolean().default(true),
};

function rules(v, ctx) {
  if (v.type === 'percent' && v.value > MAX_PERCENT_OFF) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: `At most ${MAX_PERCENT_OFF}% off` });
  }
  if (v.type === 'flat' && v.value > 1_000_000_000) ctx.addIssue({ code: 'custom', path: ['value'], message: 'Too large' });
  if (v.type === 'flat' && v.maxDiscount) ctx.addIssue({ code: 'custom', path: ['maxDiscount'], message: 'Only for percentage coupons' });
  if (v.startsAt && v.expiresAt && v.expiresAt <= v.startsAt) {
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Must be after the start date' });
  }
}

export const createCoupon = { body: z.object(fields).superRefine(rules) };

// Cross-field rules are checked by the service on the merged coupon (a partial update can't see the rest).
export const updateCoupon = { params: idParams, body: z.object(fields).partial() };

export const listCoupons = {
  query: z.object({
    ...paginationQuery,
    status: z.enum(['active', 'inactive', 'expired', 'usable']).optional(),
    q: z.string().trim().max(40).optional(),
  }),
};

export const applyCoupon = { body: z.object({ code: couponCode }) };
