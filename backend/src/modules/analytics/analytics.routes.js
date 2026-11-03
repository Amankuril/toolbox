import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { objectId } from '#core/validation/common.js';
import { PAYMENT_METHODS } from '#modules/orders/order.model.js';
import { PRODUCT_TYPES } from '#modules/products/product.model.js';
import { analyticsService } from './analytics.service.js';

/** Mounted at /public/track: one storefront page view. Answers at once; recording happens after. */
export const publicTrackRoutes = Router().post(
  '/',
  rateLimit({ keyPrefix: 'track', points: 240, duration: 60 }),
  validate({
    body: z
      .object({
        productId: objectId.optional(),
        storeSlug: z.string().trim().toLowerCase().max(120).optional(),
        // A random id the browser keeps, for counting unique visitors. Never tied to an account.
        visitor: z.string().trim().min(8).max(64).optional(),
        referrer: z.string().trim().max(500).optional(),
        utm: z.string().trim().max(80).optional(),
      })
      .refine((v) => v.productId || v.storeSlug, 'Nothing to track'),
  }),
  (req, res) => {
    res.status(204).end();
    analyticsService.track(req.body);
  },
);

const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const reportFields = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => [7, 30, 90, 365].includes(d), 'Use 7, 30, 90 or 365')
    .default(30),
  from: ymd.optional(),
  to: ymd.optional(),
  category: objectId.optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  payment: z.enum(PAYMENT_METHODS).optional(),
});
const bothEnds = (q) => Boolean(q.from) === Boolean(q.to);
const reportQuery = reportFields.refine(bothEnds, 'Give both from and to');

/** Mounted at /vendor/analytics and /admin/store/analytics. */
export const sellerAnalyticsRoutes = Router().get('/', validate({ query: reportQuery }), async (req, res) =>
  ok(res, await analyticsService.seller(req.auth.id, req.query)),
);

/** Mounted at /admin/analytics: the whole marketplace, or one seller with ?vendor=. */
export const adminAnalyticsRoutes = Router().get(
  '/',
  validate({ query: reportFields.extend({ vendor: objectId.optional() }).refine(bothEnds, 'Give both from and to') }),
  async (req, res) => ok(res, await analyticsService.marketplace(req.query)),
);
