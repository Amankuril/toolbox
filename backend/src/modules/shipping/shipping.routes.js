import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { idParams, objectId, optionalText, pincode } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { cartService } from '#modules/cart/cart.service.js';
import { PAYMENT_METHODS } from '#modules/orders/order.model.js';
import { userService } from '#modules/users/user.service.js';
import { CUSTOMER_REQUESTS } from '#services/shipping/providers/shipmozo/constants.js';
import { serializeAdminShipment, serializeCustomerShipment, serializeVendorShipment } from './shipping.serializer.js';
import { shippingQuotes } from './shipping.quotes.js';
import { shippingService } from './shipping.service.js';
import { shippingProvider } from '#services/shipping/shipping.provider.js';

const awbNumber = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9-]{4,40}$/, 'Enter a valid AWB number');
const warehouseId = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{1,12}$/, 'Invalid warehouse id'),
    z.number().int().positive(),
  ])
  .transform(String);

const perUser = (keyPrefix, points) => rateLimit({ keyPrefix, points, duration: 60, key: (req) => String(req.auth.id) });

async function sendLabel(res, shipment) {
  const label = await shippingService.label(shipment);
  res
    .status(200)
    .type(label.contentType)
    .set('Cache-Control', 'private, no-store')
    .set('Content-Disposition', `attachment; filename="label-${shipment.awbNumber.replace(/[^\w-]/g, '')}.png"`)
    .send(label.buffer);
}

/** Mounted at /public/shipping. */
export const publicShippingRoutes = Router().get(
  '/serviceability',
  rateLimit({ keyPrefix: 'ship-svc', points: 30, duration: 60 }),
  validate({ query: z.object({ productId: objectId, pincode }) }),
  async (req, res) => ok(res, await shippingQuotes.productServiceability(req.query.productId, req.query.pincode)),
);

/** Mounted at /user (order tracking sits under /user/orders/:id/tracking). */
export const userShippingRoutes = Router()
  .get('/orders/:id/tracking', perUser('ship-track', 30), validate({ params: idParams }), async (req, res) => {
    const shipments = await shippingService.forCustomer(req.auth.id, req.params.id);
    ok(res, shipments.map(serializeCustomerShipment));
  })
  .post(
    '/shipping/quote',
    perUser('ship-quote', 20),
    validate({ body: z.object({ addressId: objectId, paymentMethod: z.enum(PAYMENT_METHODS).default('razorpay') }) }),
    async (req, res) => {
      const [cart, address] = await Promise.all([cartService.view(req.auth.id), userService.address(req.auth.id, req.body.addressId)]);
      ok(res, await shippingQuotes.cartQuote(cart, address, req.body.paymentMethod));
    },
  );

/** Mounted at /vendor. Vendors only ever see shipments for their own lines. */
export const vendorShippingRoutes = Router()
  .get('/orders/:id/shipments', validate({ params: idParams }), async (req, res) => {
    const shipments = await shippingService.forOrder(req.params.id, { vendor: req.auth.id });
    ok(res, shipments.map(serializeVendorShipment));
  })
  .get('/shipments/:id/label', validate({ params: idParams }), async (req, res) => {
    await sendLabel(res, await shippingService.get(req.params.id, { vendor: req.auth.id }));
  });

const assignBody = z
  .object({ auto: z.boolean().optional(), courierId: z.coerce.number().int().positive().optional() })
  .refine((v) => v.auto || v.courierId, 'Choose a courier or auto-assign');
const returnBody = z.object({
  itemIds: z.array(objectId).max(100).optional(),
  returnReasonId: z.coerce.number().int().positive(),
  customerRequest: z.enum(CUSTOMER_REQUESTS),
  comment: optionalText(500),
});

/** Mounted at /admin. */
export const adminShippingRoutes = Router()
  .get('/orders/:id/shipments', validate({ params: idParams }), async (req, res) => {
    ok(res, (await shippingService.forOrder(req.params.id)).map(serializeAdminShipment));
  })
  // Plans one shipment per seller and pushes them; already-created shipments are left alone.
  .post('/orders/:id/shipments', validate({ params: idParams }), async (req, res) => {
    const planned = await shippingService.planForOrder(req.params.id);
    const errors = [];
    for (const s of planned) {
      await shippingService
        .push(s._id, actorOf(req))
        .catch((err) => errors.push({ shipment: s._id, message: err.message, code: err.code }));
    }
    ok(res, { shipments: (await shippingService.forOrder(req.params.id)).map(serializeAdminShipment), errors });
  })
  .post('/shipments/:id/push', validate({ params: idParams }), async (req, res) => {
    const current = await shippingService.get(req.params.id);
    const s =
      current.type === 'return'
        ? await shippingService.pushReturn(current._id, actorOf(req))
        : await shippingService.push(current._id, actorOf(req));
    ok(res, serializeAdminShipment(s));
  })
  .post('/shipments/:id/rates', validate({ params: idParams }), async (req, res) => {
    await shippingService.rates(req.params.id);
    ok(res, serializeAdminShipment(await shippingService.get(req.params.id)));
  })
  .post('/shipments/:id/assign', validate({ params: idParams, body: assignBody }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.assignCourier(req.params.id, req.body, actorOf(req))));
  })
  .post('/shipments/:id/pickup', validate({ params: idParams }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.schedulePickup(req.params.id, actorOf(req))));
  })
  .post('/shipments/:id/awb', validate({ params: idParams, body: z.object({ awbNumber }) }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.setAwb(req.params.id, req.body.awbNumber, actorOf(req))));
  })
  .post('/shipments/:id/cancel', validate({ params: idParams, body: z.object({ reason: optionalText(300) }) }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.cancel(req.params.id, req.body, actorOf(req))));
  })
  .post('/shipments/:id/tracking/refresh', validate({ params: idParams }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.refreshTracking(req.params.id)));
  })
  .post('/shipments/:id/warehouse', validate({ params: idParams, body: z.object({ warehouseId }) }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.changeWarehouse(req.params.id, req.body.warehouseId, actorOf(req))));
  })
  .post('/shipments/:id/returns', validate({ params: idParams, body: returnBody }), async (req, res) => {
    ok(res, serializeAdminShipment(await shippingService.createReturn(req.params.id, req.body, actorOf(req))));
  })
  .get('/shipments/:id/label', validate({ params: idParams }), async (req, res) => {
    await sendLabel(res, await shippingService.get(req.params.id));
  })
  .get('/shipping/status', async (_req, res) => ok(res, { enabled: Boolean(await shippingProvider.active()) }))
  .get('/shipping/health', async (_req, res) => ok(res, await shippingService.health()))
  .get('/shipping/return-reasons', async (_req, res) => ok(res, await shippingService.returnReasons()))
  .get('/shipping/warehouses', async (_req, res) => ok(res, await shippingService.listWarehouses()))
  .post(
    '/shipping/vendors/:id/warehouse',
    validate({ params: idParams, body: z.object({ warehouseId: warehouseId.optional() }) }),
    async (req, res) => ok(res, await shippingService.syncVendorWarehouse(req.params.id, req.body)),
  );
