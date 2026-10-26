import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { objectId } from '#core/validation/common.js';
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

/** Mounted at /vendor/analytics and /admin/store/analytics. */
export const sellerAnalyticsRoutes = Router().get(
  '/',
  validate({
    query: z.object({
      days: z.coerce
        .number()
        .int()
        .refine((d) => [7, 30, 90].includes(d), 'Use 7, 30 or 90')
        .default(30),
    }),
  }),
  async (req, res) => ok(res, await analyticsService.seller(req.auth.id, req.query)),
);
