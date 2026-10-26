import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { objectId } from '#core/validation/common.js';
import { wishlistInsights } from './wishlist.insights.js';
import { MAX_WISHLIST_ITEMS } from './wishlist.model.js';
import { wishlistService } from './wishlist.service.js';

const productParams = { params: z.object({ productId: objectId }) };

/** Mounted at /user/wishlist. */
export const wishlistRoutes = Router()
  .get('/', async (req, res) => ok(res, await wishlistService.list(req.auth.id)))
  .get('/ids', async (req, res) => ok(res, await wishlistService.ids(req.auth.id)))
  .put('/:productId', validate(productParams), async (req, res) => ok(res, await wishlistService.add(req.auth.id, req.params.productId)))
  .delete('/:productId', validate(productParams), async (req, res) =>
    ok(res, await wishlistService.remove(req.auth.id, req.params.productId)),
  )
  .post('/merge', validate({ body: z.object({ productIds: z.array(objectId).max(MAX_WISHLIST_ITEMS) }) }), async (req, res) =>
    ok(res, await wishlistService.merge(req.auth.id, req.body.productIds)),
  );

const insightQuery = {
  q: z.string().trim().max(80).optional(),
  product: objectId.optional(),
  vendor: objectId.optional(),
  // Saved in the last N days.
  days: z.coerce.number().int().min(1).max(365).optional(),
};

/** Mounted at /vendor/wishlists, /admin/store/wishlists (`scope` = the seller) and /admin/wishlists (everyone's). */
export function wishlistInsightRoutes({ scope }) {
  return Router()
    .get('/', validate({ query: z.object({ ...paginationQuery, ...insightQuery }) }), async (req, res) => {
      const { items, meta } = await wishlistInsights.list(scope(req), req.query);
      ok(res, items, meta);
    })
    .post('/remind', validate({ body: z.object({ ids: z.array(objectId).max(500).optional(), ...insightQuery }) }), async (req, res) =>
      ok(res, await wishlistInsights.remind(scope(req), req.body)),
    );
}
