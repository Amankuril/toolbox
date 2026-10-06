import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Order } from '#modules/orders/order.model.js';
import { Shipment } from '#modules/shipping/shipment.model.js';
import { shippingService } from '#modules/shipping/shipping.service.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { createShipmozoClient } from '#services/shipping/providers/shipmozo/client.js';
import { mapTrackingStatus, pushOrderBody, pushReturnOrderBody } from '#services/shipping/providers/shipmozo/mapper.js';
import { ShippingProviderError } from '#services/shipping/shipping.errors.js';
import { shippingProvider } from '#services/shipping/shipping.provider.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

/* ─────────────────────────── Fakes ─────────────────────────── */

function fakeShipmozo() {
  const state = { calls: [], known: new Set(), failNext: {}, tracking: {}, serviceable: true, warehouses: 0 };
  const record = (op, args) => {
    state.calls.push({ op, args });
    const failure = state.failNext[op];
    if (failure) {
      delete state.failNext[op];
      throw failure;
    }
  };
  return {
    name: 'shipmozo',
    state,
    count: (op) => state.calls.filter((c) => c.op === op).length,
    last: (op) => state.calls.filter((c) => c.op === op).at(-1)?.args,
    async info() {
      record('info');
      return { Info: 'Hello External V1 Api World!' };
    },
    async serviceability(args) {
      record('serviceability', args);
      return { serviceable: state.serviceable };
    },
    async rates(args) {
      record('rates', args);
      return [
        {
          courierId: 7,
          name: 'Delhivery Surface',
          service: 'Surface',
          charge: 9_000,
          estimatedDelivery: '3 days',
          pickupsAutomaticallyScheduled: false,
        },
        {
          courierId: 9,
          name: 'Xpressbees',
          service: 'Air',
          charge: 12_000,
          estimatedDelivery: '2 days',
          pickupsAutomaticallyScheduled: true,
        },
      ];
    },
    async pushOrder(args) {
      record('pushOrder', args);
      state.known.add(args.providerOrderId);
      return { providerOrderId: args.providerOrderId, referenceId: args.providerOrderId };
    },
    async pushReturnOrder(args) {
      record('pushReturnOrder', args);
      state.known.add(args.providerOrderId);
      return { providerOrderId: args.providerOrderId, referenceId: args.providerOrderId };
    },
    async orderExists(id) {
      record('orderExists', id);
      return state.known.has(id);
    },
    async assignCourier(args) {
      record('assignCourier', args);
      return { courier: 'Delhivery', awbNumber: null };
    },
    async autoAssign(args) {
      record('autoAssign', args);
      return { courier: 'Delhivery', courierService: 'Surface', awbNumber: `AWB${state.calls.length}` };
    },
    async schedulePickup(args) {
      record('schedulePickup', args);
      return { courier: 'Delhivery', awbNumber: `AWB${state.calls.length}`, lrNumber: 'LR1' };
    },
    async cancel(args) {
      record('cancel', args);
      return { cancelled: true };
    },
    async track(awb) {
      record('track', awb);
      const currentStatus = state.tracking[awb] ?? 'Pickup Pending';
      return {
        awbNumber: awb,
        courier: 'Delhivery',
        currentStatus,
        status: mapTrackingStatus(currentStatus),
        scans: [{ status: currentStatus, location: 'Pune', at: '2026-10-06' }],
      };
    },
    async label(awb) {
      record('label', awb);
      return { contentType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex'), createdAt: '2026-10-06 10:00:00' };
    },
    async returnReasons() {
      record('returnReasons');
      return [
        { id: 9, title: 'Item is damaged' },
        { id: 14, title: 'Other' },
      ];
    },
    async warehouses() {
      record('warehouses');
      return [{ id: '23481', title: 'Sunshine', pincode: '122018' }];
    },
    async createWarehouse(args) {
      record('createWarehouse', args);
      state.warehouses += 1;
      return { warehouseId: '23481' };
    },
    async updateOrderWarehouse(args) {
      record('updateOrderWarehouse', args);
      return { updated: true };
    },
  };
}

const rejected = (msg) => new ShippingProviderError('rejected', `Shipmozo failed: ${msg}`, { providerMessage: msg });
const timeout = () => new ShippingProviderError('timeout', 'Shipmozo timed out', { outcomeUnknown: true });

/* ─────────────────────────── Setup ─────────────────────────── */

let app;
let admin;
let vendor;
let otherVendor;
let customer;
let otherCustomer;
let product;
let addressId;
let fake;

const A = () => bearer(admin.accessToken);
const U = () => bearer(customer.accessToken);

async function placeCodOrder(qty = 1) {
  await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: qty }).expect(200);
  return (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod' }).expect(201)).body.data
    .order;
}

async function placePaidOrder() {
  await settingsService.update('payments', { razorpayEnabled: true }, { kind: 'system' });
  await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: 1 }).expect(200);
  const { order } = (
    await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)
  ).body.data;
  const doc = await Order.findById(order._id);
  await paymentService.markPaid({ providerOrderId: doc.payment.providerOrderId, paymentId: `pay_${order._id}` });
  return order;
}

async function shipFor(orderId) {
  return (await request(app).post(`${API}/admin/orders/${orderId}/shipments`).set(A()).expect(200)).body.data;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9300000001' });
  otherVendor = await approvedVendor(app, admin.accessToken, {
    phone: '9300000002',
    storeName: 'Other Tools',
    gstin: '07AAACR5055K1Z3',
    pan: 'AAACR5055K',
  });
  await setModeration({ autoApproveProducts: true });

  const cat = (await request(app).post(`${API}/admin/categories`).set(A()).send({ name: 'Sprayers' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'machinery',
        name: 'Battery Knapsack Sprayer',
        category: cat._id,
        pricing: { mrp: 500_000, price: 400_000, gstRate: 18 },
        inventory: { stock: 100, moq: 1, maxOrderQty: 10 },
        shipping: { weightKg: 4.5, lengthCm: 40, widthCm: 30, heightCm: 20 },
        hsnCode: '8424',
        publish: true,
      })
      .expect(201)
  ).body.data;

  customer = await otpSignIn(app, { phone: '9300000099', audience: 'user', register: { name: 'Asha' } });
  otherCustomer = await otpSignIn(app, { phone: '9300000098', audience: 'user', register: { name: 'Mallory' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U())
      .send({ name: 'Asha', phone: '9300000099', line1: 'Gat 7', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
      .expect(201)
  ).body.data[0]._id;

  let n = 0;
  const rzp = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: 'rzp_test_secret', webhookSecret: 'rzp_webhook_secret' });
  paymentService.useRazorpay({
    ...rzp,
    createOrder: async ({ amount, currency }) => ({ providerOrderId: `order_ship_${++n}`, amount, currency, status: 'created' }),
  });
  await settingsService.update('shipping', { flatFee: 5_000, freeAbove: 0, shipmozoEnabled: true }, { kind: 'system' });
});
afterAll(stopTestApp);

beforeEach(async () => {
  fake = fakeShipmozo();
  shippingProvider.useProvider(fake);
  await settingsService.update(
    'shipping',
    { autoAssignCourier: false, autoCreateShipments: false, blockUnserviceable: false },
    { kind: 'system' },
  );
});

/* ─────────────────────────── HTTP client ─────────────────────────── */

describe('shipmozo client', () => {
  const client = (fetchImpl) =>
    createShipmozoClient({
      baseUrl: 'https://shipping-api.com/app/api/v1/',
      publicKey: 'pub',
      privateKey: 'priv',
      timeoutMs: 50,
      fetchImpl,
    });
  const reply = (status, body) => async () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('sends both keys as headers, strips the trailing slash and returns data on result "1"', async () => {
    let seen;
    const c = client(async (url, init) => {
      seen = { url: String(url), headers: init.headers };
      return reply(200, { result: '1', message: 'Success', data: { Info: 'Hello' } })();
    });
    expect(await c.get('/info')).toEqual({ Info: 'Hello' });
    expect(seen.url).toBe('https://shipping-api.com/app/api/v1/info');
    expect(seen.headers).toMatchObject({ 'public-key': 'pub', 'private-key': 'priv' });
  });

  it('treats HTTP 200 with result "0" as a failure', async () => {
    const err = await client(reply(200, { result: '0', message: 'Error', data: { error: 'please setup auto assign' } }))
      .post('/auto-assign-order', { order_id: 'x' })
      .catch((e) => e);
    expect(err).toMatchObject({ kind: 'rejected', providerMessage: 'Error: please setup auto assign', outcomeUnknown: false });
  });

  it('flags timed-out writes as outcome-unknown and auth failures distinctly', async () => {
    const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    expect(
      await client(hang)
        .post('/push-order', {})
        .catch((e) => e),
    ).toMatchObject({ kind: 'timeout', outcomeUnknown: true });
    expect(
      await client(hang)
        .get('/info')
        .catch((e) => e),
    ).toMatchObject({ kind: 'timeout', outcomeUnknown: false });
    expect(
      await client(reply(401, { message: 'Unauthorized' }))
        .get('/info')
        .catch((e) => e),
    ).toMatchObject({ kind: 'auth' });
    const err = await client(reply(401, {}))
      .get('/info')
      .catch((e) => e);
    expect(JSON.stringify(err)).not.toContain('priv');
  });
});

describe('shipmozo mapper', () => {
  const base = {
    providerOrderId: 'TB1',
    orderDate: new Date('2026-10-01T10:00:00Z'),
    consignee: {
      name: 'Asha',
      phone: '+919300000099',
      address: { line1: 'Gat 7', city: 'Nashik', state: 'Maharashtra', pincode: '422001' },
    },
    items: [{ name: 'Sprayer', sku: 'S1', quantity: 2, hsnCode: '8424', unitPrice: 400_000 }],
    package: { weightGrams: 9000, lengthCm: 40, widthCm: 30, heightCm: 40 },
    warehouseId: '23481',
  };

  it('sends COD amount only for COD shipments, in rupees, with numeric phone and pincode', () => {
    const cod = pushOrderBody({ ...base, paymentType: 'cod', codAmount: 805_000 });
    expect(cod).toMatchObject({
      payment_type: 'COD',
      cod_amount: '8050',
      consignee_phone: 9300000099,
      consignee_pin_code: 422001,
      order_date: '2026-10-01',
      weight: 9000,
    });
    expect(cod.product_detail[0]).toMatchObject({ unit_price: 4000, quantity: 2 });
    expect(pushOrderBody({ ...base, paymentType: 'prepaid', codAmount: 805_000 })).toMatchObject({
      payment_type: 'PREPAID',
      cod_amount: '',
    });
  });

  it('sends return weight in kg as the guide documents', () => {
    const body = pushReturnOrderBody({ ...base, pickup: base.consignee, returnReasonId: 9, customerRequest: 'REFUND' });
    expect(body).toMatchObject({ weight: 9, return_reason_id: 9, customer_request: 'REFUND', pickup_pin_code: 422001 });
  });

  it('maps free-text tracking statuses', () => {
    expect(mapTrackingStatus('Pickup Pending')).toBe('pickup_pending');
    expect(mapTrackingStatus('In Transit')).toBe('in_transit');
    expect(mapTrackingStatus('Out For Delivery')).toBe('out_for_delivery');
    expect(mapTrackingStatus('Delivered')).toBe('delivered');
    expect(mapTrackingStatus('RTO In Transit')).toBe('return_in_transit');
    expect(mapTrackingStatus('Something new')).toBeNull();
  });
});

/* ─────────────────────────── Flows ─────────────────────────── */

describe('shipment creation', () => {
  it('pushes a COD order once per seller, registers the warehouse once, and is idempotent', async () => {
    const order = await placeCodOrder(2);
    const { shipments, errors } = await shipFor(order._id);
    expect(errors).toEqual([]);
    expect(shipments).toHaveLength(1);
    expect(shipments[0]).toMatchObject({ status: 'created', paymentType: 'cod', providerOrderId: order.orderNumber, warehouseId: '23481' });
    // 2 × ₹4000 + ₹50 shipping, computed server-side.
    expect(shipments[0].codAmount).toBe(805_000);
    expect(shipments[0].package).toEqual({ weightGrams: 9000, lengthCm: 40, widthCm: 30, heightCm: 40 });
    expect(fake.last('pushOrder')).toMatchObject({ paymentType: 'cod', codAmount: 805_000, warehouseId: '23481' });

    await shipFor(order._id);
    await request(app).post(`${API}/admin/shipments/${shipments[0]._id}/push`).set(A()).expect(409);
    expect(fake.count('pushOrder')).toBe(1);
    expect(fake.count('createWarehouse')).toBe(1);
    expect((await Vendor.findById(vendor.account._id).lean()).shipping.warehouseId).toBe('23481');

    // A second order reuses the stored warehouse id.
    await shipFor((await placeCodOrder())._id);
    expect(fake.count('createWarehouse')).toBe(1);
  });

  it('pushes paid online orders as PREPAID; a shipping failure leaves payment alone and is retryable', async () => {
    const order = await placePaidOrder();
    fake.state.failNext.pushOrder = rejected('Invalid warehouse');
    const { shipments, errors } = await shipFor(order._id);
    expect(errors[0]).toMatchObject({ code: 'SHIPPING_REJECTED', message: 'Shipmozo: Invalid warehouse' });
    expect(shipments[0]).toMatchObject({ status: 'pending', failedAttempts: 1, lastError: { message: 'Invalid warehouse' } });

    const saved = await Order.findById(order._id).lean();
    expect(saved).toMatchObject({ status: 'placed', payment: { status: 'paid' } });

    const retried = (await request(app).post(`${API}/admin/shipments/${shipments[0]._id}/push`).set(A()).expect(200)).body.data;
    expect(retried).toMatchObject({ status: 'created', paymentType: 'prepaid', lastError: null });
    expect(fake.last('pushOrder')).toMatchObject({ paymentType: 'prepaid' });
  });

  it('ships part-paid orders as COD for the balance only', async () => {
    await settingsService.update(
      'payments',
      { razorpayEnabled: true, partialEnabled: true, partialAdvancePercent: 25 },
      { kind: 'system' },
    );
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: 2 }).expect(200);
    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'partial' }).expect(201)
    ).body.data;
    const doc = await Order.findById(order._id);
    await paymentService.markPaid({ providerOrderId: doc.payment.providerOrderId, paymentId: `pay_${order._id}` });
    const [s] = (await shipFor(order._id)).shipments;
    expect(s).toMatchObject({ paymentType: 'cod', codAmount: order.amounts.balanceDue });
    expect(order.amounts.advance + order.amounts.balanceDue).toBe(order.amounts.total);
    expect(fake.last('pushOrder')).toMatchObject({ paymentType: 'cod', codAmount: order.amounts.balanceDue });
    await settingsService.update('payments', { partialEnabled: false }, { kind: 'system' });
  });

  it('verifies a timed-out push with get-order-detail instead of pushing twice', async () => {
    const order = await placeCodOrder();
    // The push reaches Shipmozo, but the response is lost.
    fake.pushOrder = async function (args) {
      fake.state.calls.push({ op: 'pushOrder', args });
      fake.state.known.add(args.providerOrderId);
      throw timeout();
    };
    const { shipments, errors } = await shipFor(order._id);
    expect(errors[0].code).toBe('SHIPPING_TIMEOUT');
    expect(shipments[0]).toMatchObject({ status: 'pending', needsVerification: true });

    const retried = (await request(app).post(`${API}/admin/shipments/${shipments[0]._id}/push`).set(A()).expect(200)).body.data;
    expect(retried).toMatchObject({ status: 'created', needsVerification: false });
    expect(fake.count('orderExists')).toBe(1);
    expect(fake.count('pushOrder')).toBe(1);
  });

  it('auto-create job pushes new orders and backs off failures', async () => {
    await settingsService.update('shipping', { autoCreateShipments: true }, { kind: 'system' });
    const order = await placeCodOrder();
    fake.state.failNext.pushOrder = new ShippingProviderError('network', 'down', { outcomeUnknown: false });
    await shippingService.autoCreate();
    const s = await Shipment.findOne({ order: order._id }).lean();
    expect(s).toMatchObject({ status: 'pending', failedAttempts: 1 });
    // Inside the backoff window: not retried yet.
    await shippingService.autoCreate();
    expect(fake.count('pushOrder')).toBe(1);
    await Shipment.updateOne({ _id: s._id }, { 'lastError.at': new Date(Date.now() - 5 * 60_000) });
    await shippingService.autoCreate();
    expect((await Shipment.findById(s._id).lean()).status).toBe('created');
    await settingsService.update('shipping', { autoCreateShipments: false }, { kind: 'system' });
  });
});

describe('courier, pickup, tracking', () => {
  it('only assigns couriers returned by the rate calculator, then schedules pickup', async () => {
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;

    const unquoted = await request(app).post(`${API}/admin/shipments/${s._id}/assign`).set(A()).send({ courierId: 7 }).expect(422);
    expect(unquoted.body.error.code).toBe('COURIER_NOT_QUOTED');

    const quoted = (await request(app).post(`${API}/admin/shipments/${s._id}/rates`).set(A()).expect(200)).body.data;
    expect(quoted.rateQuotes.map((q) => q.courierId)).toEqual([7, 9]);
    expect(fake.last('rates')).toMatchObject({
      pickupPincode: '411019',
      deliveryPincode: '422001',
      paymentType: 'cod',
      shipmentType: 'forward',
    });
    await request(app).post(`${API}/admin/shipments/${s._id}/assign`).set(A()).send({ courierId: 123 }).expect(422);

    const assigned = (await request(app).post(`${API}/admin/shipments/${s._id}/assign`).set(A()).send({ courierId: 7 }).expect(200)).body
      .data;
    expect(assigned).toMatchObject({
      status: 'courier_assigned',
      courier: { id: 7, name: 'Delhivery' },
      pickupsAutomaticallyScheduled: false,
    });
    expect(fake.last('assignCourier')).toEqual({ providerOrderId: order.orderNumber, courierId: 7 });

    const picked = (await request(app).post(`${API}/admin/shipments/${s._id}/pickup`).set(A()).expect(200)).body.data;
    expect(picked).toMatchObject({ status: 'pickup_scheduled', lrNumber: 'LR1' });
    expect(picked.awbNumber).toMatch(/^AWB/);
    await request(app).post(`${API}/admin/shipments/${s._id}/pickup`).set(A()).expect(409);
  });

  it('refuses schedule-pickup for couriers that schedule automatically', async () => {
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;
    await request(app).post(`${API}/admin/shipments/${s._id}/rates`).set(A()).expect(200);
    await request(app).post(`${API}/admin/shipments/${s._id}/assign`).set(A()).send({ courierId: 9 }).expect(200);
    const res = await request(app).post(`${API}/admin/shipments/${s._id}/pickup`).set(A()).expect(409);
    expect(res.body.error.code).toBe('PICKUP_AUTOMATIC');
    expect(fake.count('schedulePickup')).toBe(0);
  });

  it('surfaces the documented auto-assign error and keeps the shipment created', async () => {
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;
    fake.state.failNext.autoAssign = rejected('Error: please setup auto assign');
    const res = await request(app).post(`${API}/admin/shipments/${s._id}/assign`).set(A()).send({ auto: true }).expect(422);
    expect(res.body.error.message).toContain('please setup auto assign');
    expect((await Shipment.findById(s._id).lean()).status).toBe('created');
  });

  it('tracking moves items through fulfilment, marks COD paid on delivery, and stops polling', async () => {
    await settingsService.update('shipping', { autoAssignCourier: true }, { kind: 'system' });
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;
    expect(s).toMatchObject({ status: 'courier_assigned' });
    const awb = s.awbNumber;

    // Customer can no longer cancel the line once a courier has it.
    const blocked = await request(app)
      .post(`${API}/user/orders/${order._id}/items/${order.items[0]._id}/cancel`)
      .set(U())
      .send({})
      .expect(409);
    expect(blocked.body.error.code).toBe('SHIPMENT_IN_PROGRESS');

    fake.state.tracking[awb] = 'In Transit';
    expect(await shippingService.syncTracking()).toBeGreaterThan(0);
    let saved = await Order.findById(order._id).lean();
    expect(saved.items[0]).toMatchObject({ status: 'shipped', tracking: { trackingNumber: awb, carrier: 'Delhivery' } });

    fake.state.tracking[awb] = 'Delivered';
    await request(app).post(`${API}/admin/shipments/${s._id}/tracking/refresh`).set(A()).expect(200);
    saved = await Order.findById(order._id).lean();
    expect(saved).toMatchObject({ status: 'completed', payment: { status: 'paid' } });
    expect(saved.items[0].status).toBe('delivered');

    const tracked = fake.count('track');
    await Shipment.updateOne({ _id: s._id }, { 'tracking.lastSyncedAt': new Date(0) });
    await shippingService.syncTracking();
    expect(fake.count('track')).toBe(tracked);

    // Customer timeline
    const view = (await request(app).get(`${API}/user/orders/${order._id}/tracking`).set(U()).expect(200)).body.data;
    expect(view[0].steps.every((st) => st.done)).toBe(true);
    expect(view[0]).not.toHaveProperty('providerOrderId');
    expect(view[0]).not.toHaveProperty('lastError');
    expect(view[0]).not.toHaveProperty('codAmount');
  });

  it('serves labels to the admin and the owning vendor only', async () => {
    await settingsService.update('shipping', { autoAssignCourier: true }, { kind: 'system' });
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;
    const res = await request(app).get(`${API}/admin/shipments/${s._id}/label`).set(A()).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['cache-control']).toContain('no-store');
    await request(app).get(`${API}/vendor/shipments/${s._id}/label`).set(bearer(vendor.accessToken)).expect(200);
    await request(app).get(`${API}/vendor/shipments/${s._id}/label`).set(bearer(otherVendor.accessToken)).expect(404);
  });
});

describe('cancellation', () => {
  it('cancels with the provider before pickup and only updates locally on confirmation', async () => {
    await settingsService.update('shipping', { autoAssignCourier: true }, { kind: 'system' });
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;

    fake.state.failNext.cancel = rejected('Shipment already manifested');
    await request(app).post(`${API}/admin/shipments/${s._id}/cancel`).set(A()).send({ reason: 'Customer asked' }).expect(422);
    expect((await Shipment.findById(s._id).lean()).status).toBe('courier_assigned');

    const done = (await request(app).post(`${API}/admin/shipments/${s._id}/cancel`).set(A()).send({ reason: 'Customer asked' }).expect(200))
      .body.data;
    expect(done).toMatchObject({ status: 'cancelled', active: false });
    expect(fake.last('cancel')).toEqual({ providerOrderId: order.orderNumber, awbNumber: s.awbNumber });
    await request(app).post(`${API}/admin/shipments/${s._id}/cancel`).set(A()).send({}).expect(409);

    // The line can now be cancelled, and a fresh shipment would use a new provider order id.
    const again = await shipFor(order._id);
    expect(again.shipments.find((x) => x.active).providerOrderId).toBe(`${order.orderNumber}-A2`);
  });

  it('refuses to cancel delivered shipments', async () => {
    await settingsService.update('shipping', { autoAssignCourier: true }, { kind: 'system' });
    const order = await placeCodOrder();
    const [s] = (await shipFor(order._id)).shipments;
    fake.state.tracking[s.awbNumber] = 'Delivered';
    await shippingService.refreshTracking(s._id);
    await request(app).post(`${API}/admin/shipments/${s._id}/cancel`).set(A()).send({}).expect(409);
    expect(fake.count('cancel')).toBe(0);
  });
});

describe('returns', () => {
  it('books a reverse pickup for delivered items without refunding anything', async () => {
    await settingsService.update('shipping', { autoAssignCourier: true }, { kind: 'system' });
    const order = await placePaidOrder();
    const [s] = (await shipFor(order._id)).shipments;

    await request(app)
      .post(`${API}/admin/shipments/${s._id}/returns`)
      .set(A())
      .send({ returnReasonId: 9, customerRequest: 'REFUND' })
      .expect(409);

    fake.state.tracking[s.awbNumber] = 'Delivered';
    await shippingService.refreshTracking(s._id);

    const reasons = (await request(app).get(`${API}/admin/shipping/return-reasons`).set(A()).expect(200)).body.data;
    expect(reasons).toContainEqual({ id: 9, title: 'Item is damaged' });
    await request(app)
      .post(`${API}/admin/shipments/${s._id}/returns`)
      .set(A())
      .send({ returnReasonId: 99, customerRequest: 'REFUND' })
      .expect(422);

    const ret = (
      await request(app)
        .post(`${API}/admin/shipments/${s._id}/returns`)
        .set(A())
        .send({ returnReasonId: 9, customerRequest: 'REFUND', comment: 'Nozzle cracked' })
        .expect(200)
    ).body.data;
    expect(ret).toMatchObject({
      type: 'return',
      status: 'created',
      providerOrderId: `${order.orderNumber}-RET1`,
      returnInfo: { reasonId: 9, customerRequest: 'REFUND' },
    });
    expect(fake.last('pushReturnOrder')).toMatchObject({
      pickup: { address: { pincode: '422001' } },
      warehouseId: '23481',
      returnReasonId: 9,
    });

    await request(app)
      .post(`${API}/admin/shipments/${s._id}/returns`)
      .set(A())
      .send({ returnReasonId: 9, customerRequest: 'REFUND' })
      .expect(409);
    expect((await Order.findById(order._id).lean()).payment.status).toBe('paid');
  });
});

describe('serviceability and access control', () => {
  it('checks product serviceability server-side and can block checkout', async () => {
    const ok = (
      await request(app).get(`${API}/public/shipping/serviceability`).query({ productId: product._id, pincode: '422001' }).expect(200)
    ).body.data;
    expect(ok).toEqual({ serviceable: true });
    expect(fake.last('serviceability')).toEqual({ pickupPincode: '411019', deliveryPincode: '422001' });
    await request(app).get(`${API}/public/shipping/serviceability`).query({ productId: product._id, pincode: '12' }).expect(422);

    await settingsService.update('shipping', { blockUnserviceable: true }, { kind: 'system' });
    fake.state.serviceable = false;
    // Different pincode so the cached answer for 422001 isn't reused.
    const far = (
      await request(app)
        .post(`${API}/user/addresses`)
        .set(U())
        .send({ name: 'Asha', phone: '9300000099', line1: 'Remote', city: 'Leh', state: 'Ladakh', pincode: '194101' })
        .expect(201)
    ).body.data.find((a) => a.pincode === '194101');
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: 1 }).expect(200);
    const res = await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(U())
      .send({ addressId: far._id, paymentMethod: 'cod' })
      .expect(422);
    expect(res.body.error.code).toBe('PINCODE_NOT_SERVICEABLE');

    // A provider outage never blocks checkout.
    fake.serviceability = async () => {
      throw new ShippingProviderError('network', 'down');
    };
    const far2 = (
      await request(app)
        .post(`${API}/user/addresses`)
        .set(U())
        .send({ name: 'Asha', phone: '9300000099', line1: 'Remote 2', city: 'Kargil', state: 'Ladakh', pincode: '194103' })
        .expect(201)
    ).body.data.find((a) => a.pincode === '194103');
    await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId: far2._id, paymentMethod: 'cod' }).expect(201);
  });

  it('keeps customers to their own shipments and admin actions to admins', async () => {
    const order = await placeCodOrder();
    await shipFor(order._id);
    await request(app).get(`${API}/user/orders/${order._id}/tracking`).set(bearer(otherCustomer.accessToken)).expect(404);
    await request(app).post(`${API}/admin/orders/${order._id}/shipments`).set(U()).expect(401);
    await request(app).get(`${API}/admin/shipping/warehouses`).set(bearer(vendor.accessToken)).expect(401);
    const vendorView = (
      await request(app).get(`${API}/vendor/orders/${order._id}/shipments`).set(bearer(otherVendor.accessToken)).expect(200)
    ).body.data;
    expect(vendorView).toEqual([]);
  });

  it('cart quote uses server-side weights and never exposes courier ids', async () => {
    await settingsService.update('shipping', { blockUnserviceable: false }, { kind: 'system' });
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: 2 }).expect(200);
    const q = (await request(app).post(`${API}/user/shipping/quote`).set(U()).send({ addressId, paymentMethod: 'cod' }).expect(200)).body
      .data;
    expect(q.sellers[0]).toMatchObject({ serviceable: true, cheapest: { courier: 'Delhivery Surface', charge: 9_000 } });
    expect(JSON.stringify(q)).not.toContain('courierId');
    expect(fake.last('rates')).toMatchObject({ package: { weightGrams: 9000 }, orderAmount: 800_000 });
  });

  it('exposes only the fee settings publicly, never Shipmozo keys or toggles', async () => {
    const pub = (await request(app).get(`${API}/public/settings`).expect(200)).body.data;
    expect(pub.shipping).toEqual({ flatFee: 5_000, freeAbove: 0 });
    expect(JSON.stringify(pub)).not.toContain('smz_test');
  });
});
