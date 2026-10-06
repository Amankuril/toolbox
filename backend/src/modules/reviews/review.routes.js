import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { noContent, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams, objectId, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { REVIEW_STATUSES } from './review.model.js';
import { reviewService } from './review.service.js';

const rating = z.coerce.number().int().min(1).max(5);
const productParams = z.object({ productId: objectId });

/** Mounted at /public/products: GET /:productId/reviews. */
export const publicReviewRoutes = Router().get(
  '/:productId/reviews',
  validate({
    params: productParams,
    query: z.object({ ...paginationQuery, sort: z.enum(['recent', 'highest', 'lowest']).optional(), rating: rating.optional() }),
  }),
  async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const { summary, items, meta } = await reviewService.listForProduct(req.params.productId, req.query);
    ok(res, { summary, items }, meta);
  },
);

const writeLimit = rateLimit({ keyPrefix: 'review-write', points: 20, duration: 60 * 60, key: (req) => String(req.auth.id) });

/** Mounted at /user/products: the signed-in customer's own review. */
export const userReviewRoutes = Router()
  .get('/:productId/review', validate({ params: productParams }), async (req, res) =>
    ok(res, await reviewService.mine(req.account, req.params.productId)),
  )
  .put(
    '/:productId/review',
    writeLimit,
    validate({ params: productParams, body: z.object({ rating, title: optionalText(120), body: optionalText(2000) }) }),
    async (req, res) => ok(res, await reviewService.upsert(req.account, req.params.productId, req.body)),
  )
  .delete('/:productId/review', validate({ params: productParams }), async (req, res) => {
    await reviewService.remove(req.account, req.params.productId);
    noContent(res);
  });

/** Mounted at /admin/reviews. */
export const adminReviewRoutes = Router()
  .get(
    '/',
    validate({
      query: z.object({
        ...paginationQuery,
        status: z.enum(REVIEW_STATUSES).optional(),
        rating: rating.optional(),
        product: objectId.optional(),
      }),
    }),
    async (req, res) => {
      const { items, meta } = await reviewService.adminList(req.query);
      ok(res, items, meta);
    },
  )
  .patch(
    '/:id',
    validate({ params: idParams, body: z.object({ status: z.enum(REVIEW_STATUSES), note: optionalText(500) }) }),
    async (req, res) => ok(res, await reviewService.moderate(req.params.id, req.body, actorOf(req))),
  );
