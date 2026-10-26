import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { addressSchema, idParams, indianPhone, nonEmpty, objectId, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { manualOrderService } from './manual.service.js';
import { ORDER_LINK_DAYS, ORDER_LINK_STATUSES } from './orderLink.model.js';

const paise = z.number().int().min(0).max(1_000_000_000);

const createBody = z
  .object({
    mode: z.enum(['create', 'share']),
    // An existing customer, or a mobile number (and name) to find or open an account for.
    customer: z.union([z.object({ userId: objectId }), z.object({ phone: indianPhone, name: nonEmpty(120) })]),
    address: addressSchema.extend({ name: optionalText(120), phone: indianPhone.optional() }),
    items: z
      .array(
        z.object({
          product: objectId,
          variant: objectId.optional(),
          quantity: z.number().int().min(1).max(100_000),
          // Paise; the list price when left out.
          unitPrice: paise.optional(),
        }),
      )
      .min(1)
      .max(50),
    discount: paise.default(0),
    deliveryFee: paise.default(0),
    notes: optionalText(500),
    // create only: collect cash on delivery, or already settled offline.
    paymentMethod: z.enum(['cod', 'offline']).default('cod'),
    // share only.
    validDays: z.number().int().min(1).max(ORDER_LINK_DAYS.max).optional(),
  })
  .refine((v) => new Set(v.items.map((i) => `${i.product}:${i.variant ?? ''}`)).size === v.items.length, {
    message: 'Each product appears once',
    path: ['items'],
  });

const linksQuery = z.object({ ...paginationQuery, status: z.enum([...ORDER_LINK_STATUSES, 'expired']).optional() });

/**
 * Mounted at /admin/manual-orders (any seller's products), /vendor/manual-orders and /admin/store/manual-orders
 * (the seller's own products). `scope(req)` says which.
 */
export function manualOrderRoutes({ scope }) {
  return Router()
    .get('/customer', validate({ query: z.object({ phone: indianPhone }) }), async (req, res) =>
      ok(res, await manualOrderService.lookupCustomer(req.query.phone)),
    )
    .post('/', validate({ body: createBody }), async (req, res) => created(res, await manualOrderService.create(req.body, actorOf(req), scope(req))))
    .get('/links', validate({ query: linksQuery }), async (req, res) => {
      const { items, meta } = await manualOrderService.listLinks({ ...scope(req), ...req.query });
      ok(res, items, meta);
    })
    .post('/links/:id/cancel', validate({ params: idParams }), async (req, res) =>
      ok(res, await manualOrderService.cancelLink(req.params.id, scope(req))),
    );
}

const tokenParams = z.object({ token: z.string().trim().min(16).max(64) });
const payLimit = rateLimit({ keyPrefix: 'order-link', points: 30, duration: 60 });

/** Mounted at /public/pay: the customer's side of a shared order link. */
export const publicPayRoutes = Router()
  .use(payLimit)
  .get('/:token', validate({ params: tokenParams }), async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    ok(res, await manualOrderService.publicView(req.params.token));
  })
  .post('/:token/start', validate({ params: tokenParams }), async (req, res) => ok(res, await manualOrderService.startPayment(req.params.token)))
  .post(
    '/:token/verify',
    validate({
      params: tokenParams,
      body: z.object({
        providerOrderId: z.string().trim().min(1).max(100),
        paymentId: z.string().trim().min(1).max(100),
        signature: z.string().trim().min(1).max(200),
      }),
    }),
    async (req, res) => ok(res, await manualOrderService.verifyPayment(req.params.token, req.body)),
  )
  .post('/:token/failed', validate({ params: tokenParams, body: z.object({ reason: optionalText(300) }) }), async (req, res) => {
    await manualOrderService.paymentFailed(req.params.token, req.body.reason);
    ok(res, { recorded: true });
  });
