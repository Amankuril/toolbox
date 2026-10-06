import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { objectId } from '#core/validation/common.js';
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
