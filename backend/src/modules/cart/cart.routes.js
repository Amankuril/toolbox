import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { objectId } from '#core/validation/common.js';
import { MAX_CART_ITEMS } from './cart.model.js';
import { cartService } from './cart.service.js';

const quantity = z.number().int().min(1).max(100_000);

/** Mounted at /user/cart. */
export const cartRoutes = Router()
  .get('/', async (req, res) => ok(res, await cartService.get(req.auth.id)))
  .put(
    '/items/:productId',
    validate({ params: z.object({ productId: objectId }), body: z.object({ quantity, variantId: objectId.optional() }) }),
    async (req, res) => ok(res, await cartService.setItem(req.auth.id, req.params.productId, req.body.quantity, req.body.variantId)),
  )
  .delete(
    '/items/:productId',
    validate({ params: z.object({ productId: objectId }), query: z.object({ variantId: objectId.optional() }) }),
    async (req, res) => ok(res, await cartService.removeItem(req.auth.id, req.params.productId, req.query.variantId)),
  )
  .post(
    '/merge',
    validate({
      body: z.object({ items: z.array(z.object({ productId: objectId, variantId: objectId.optional(), quantity })).max(MAX_CART_ITEMS) }),
    }),
    async (req, res) => ok(res, await cartService.merge(req.auth.id, req.body.items)),
  );
