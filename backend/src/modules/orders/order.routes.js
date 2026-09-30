import express, { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { gstin, idParams, objectId, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { ITEM_STATUSES, ORDER_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from './order.model.js';
import { orderService } from './order.service.js';

const itemParams = z.object({ id: objectId, itemId: objectId });
const tracking = z
  .object({
    carrier: optionalText(80),
    trackingNumber: optionalText(80),
    url: z.url({ protocol: /^https?$/ }).max(500).optional(),
  })
  .optional();

const checkoutBody = z.object({
  addressId: objectId,
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: optionalText(500),
  gstin: gstin.optional(),
  businessName: optionalText(200),
});

const verifyBody = z.object({
  providerOrderId: z.string().trim().min(1).max(100),
  paymentId: z.string().trim().min(1).max(100),
  signature: z.string().trim().min(1).max(200),
});

/** Mounted at /user/orders. */
export const userOrderRoutes = Router()
  .get('/', validate({ query: z.object(paginationQuery) }), async (req, res) => {
    const { items, meta } = await orderService.userList(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .post('/checkout', validate({ body: checkoutBody }), async (req, res) => created(res, await orderService.checkout(req.account, req.body)))
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await orderService.userGet(req.auth.id, req.params.id)))
  .post('/:id/payment/verify', validate({ params: idParams, body: verifyBody }), async (req, res) =>
    ok(res, await orderService.verifyPayment(req.account, req.params.id, req.body)),
  )
  .post('/:id/payment/retry', validate({ params: idParams }), async (req, res) => ok(res, await orderService.retryPayment(req.account, req.params.id)))
  .post('/:id/payment/failed', validate({ params: idParams, body: z.object({ reason: optionalText(300) }) }), async (req, res) => {
    await orderService.recordPaymentFailure(req.account, req.params.id, req.body.reason);
    ok(res, { recorded: true });
  })
  .post('/:id/items/:itemId/cancel', validate({ params: itemParams, body: z.object({ reason: optionalText(500) }) }), async (req, res) => {
    const order = await orderService.updateItem(
      { orderId: req.params.id, itemId: req.params.itemId, userId: req.auth.id },
      { status: 'cancelled', note: req.body.reason },
      actorOf(req),
    );
    ok(res, orderService.serializeOrder(order));
  });

const vendorListQuery = z.object({ ...paginationQuery, status: z.enum(ITEM_STATUSES).optional(), q: z.string().trim().max(40).optional() });
const itemUpdateBody = z
  .object({ status: z.enum(ITEM_STATUSES).optional(), tracking, note: optionalText(500) })
  .refine((v) => v.status || v.tracking, 'Nothing to update');

/** Mounted at /vendor/orders. */
export const vendorOrderRoutes = Router()
  .get('/', validate({ query: vendorListQuery }), async (req, res) => {
    const { items, meta } = await orderService.vendorList(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await orderService.vendorGet(req.auth.id, req.params.id)))
  .patch('/:id/items/:itemId', validate({ params: itemParams, body: itemUpdateBody }), async (req, res) => {
    const order = await orderService.updateItem({ orderId: req.params.id, itemId: req.params.itemId, vendorId: req.auth.id }, req.body, actorOf(req));
    ok(res, orderService.serializeVendorOrder(order, req.auth.id));
  });

const adminListQuery = z.object({
  ...paginationQuery,
  status: z.enum(ORDER_STATUSES).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS).optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  vendor: objectId.optional(),
  q: z.string().trim().max(40).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

/** Mounted at /admin/orders. */
export const adminOrderRoutes = Router()
  .get('/', validate({ query: adminListQuery }), async (req, res) => {
    const { items, meta } = await orderService.adminList(req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await orderService.adminGet(req.params.id)))
  .patch('/:id/items/:itemId', validate({ params: itemParams, body: itemUpdateBody }), async (req, res) => {
    await orderService.updateItem({ orderId: req.params.id, itemId: req.params.itemId }, req.body, actorOf(req));
    ok(res, await orderService.adminGet(req.params.id));
  });

/**
 * Mounted at /webhooks, BEFORE the JSON body parser: signature verification needs the raw bytes.
 */
export const webhookRoutes = Router().post('/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const result = await orderService.handleRazorpayWebhook({
    rawBody: Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0),
    signature: req.get('x-razorpay-signature'),
    eventId: req.get('x-razorpay-event-id'),
  });
  ok(res, result);
});
