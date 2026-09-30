import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '#core/utils/crypto.js';
import { Order } from '#modules/orders/order.model.js';
import { orderService } from '#modules/orders/order.service.js';
import { Product } from '#modules/products/product.model.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret';
const WEBHOOK_SECRET = 'rzp_webhook_secret';

/** Real signature logic, fake network calls. */
function fakeRazorpay() {
  const real = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
  let n = 0;
  const refunds = [];
  return {
    ...real,
    refunds,
    async createOrder({ amount, currency }) {
      n += 1;
      return { providerOrderId: `order_test_${n}`, amount, currency, status: 'created' };
    },
    async refund(paymentId, { amount } = {}) {
      refunds.push({ paymentId, amount });
      return { refundId: `rfnd_${refunds.length}`, amount, status: 'processed' };
    },
  };
}

let app;
let admin;
let vendor;
let customer;
let product;
let addressId;
const razorpay = fakeRazorpay();

async function stockOf(id) {
  return (await Product.findById(id).lean()).inventory.stock;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9200000001' });
  await setModeration({ autoApproveProducts: true });

  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Pumps' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'machinery',
        name: 'Kirloskar 1HP Monoblock Pump',
        category: cat._id,
        pricing: { mrp: 800_000, price: 649_900, gstRate: 18 },
        inventory: { stock: 5, moq: 1, maxOrderQty: 3 },
        publish: true,
      })
      .expect(201)
  ).body.data;

  customer = await otpSignIn(app, { phone: '9200000099', audience: 'user', register: { name: 'Farmer Joe' } });
  const addresses = await request(app)
    .post(`${API}/user/addresses`)
    .set(bearer(customer.accessToken))
    .send({ name: 'Joe', phone: '9200000099', line1: 'Plot 4, Village Road', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
    .expect(201);
  addressId = addresses.body.data[0]._id;

  paymentService.useRazorpay(razorpay);
  await settingsService.update('shipping', { flatFee: 10_000, freeAbove: 1_000_000 }, { kind: 'system' });
});
afterAll(stopTestApp);

const user = () => bearer(customer.accessToken);

describe('cart', () => {
  it('enforces MOQ / max quantity and prices lines from live product data', async () => {
    const tooMany = await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 4 }).expect(422);
    expect(tooMany.body.error).toMatchObject({ code: 'EXCEEDS_STOCK', details: { max: 3 } });

    const cart = (await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 2 }).expect(200)).body.data;
    expect(cart.summary).toMatchObject({ itemCount: 2, subtotal: 1_299_800, shipping: 0, total: 1_299_800, savings: 300_200 });
    expect(cart.items[0].product.name).toBe('Kirloskar 1HP Monoblock Pump');
  });
});

describe('cash on delivery', () => {
  it('reserves stock, lets the vendor fulfil, and marks paid on delivery', async () => {
    const res = await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'cod' }).expect(201);
    const order = res.body.data.order;
    expect(order).toMatchObject({ status: 'placed', payment: { method: 'cod', status: 'pending' }, amounts: { total: 1_299_800 } });
    expect(order.orderNumber).toMatch(/^TB\d{6}-[0-9A-F]{6}$/);
    expect(res.body.data.payment).toBeNull();
    expect(await stockOf(product._id)).toBe(3);
    expect((await request(app).get(`${API}/user/cart`).set(user())).body.data.items).toHaveLength(0);

    const v = bearer(vendor.accessToken);
    const vendorView = (await request(app).get(`${API}/vendor/orders/${order._id}`).set(v).expect(200)).body.data;
    expect(vendorView.amounts.subtotal).toBe(1_299_800);

    const itemId = order.items[0]._id;
    const bad = await request(app).patch(`${API}/vendor/orders/${order._id}/items/${itemId}`).set(v).send({ status: 'delivered' }).expect(409);
    expect(bad.body.error.code).toBe('INVALID_TRANSITION');

    for (const status of ['confirmed', 'shipped', 'delivered']) {
      await request(app)
        .patch(`${API}/vendor/orders/${order._id}/items/${itemId}`)
        .set(v)
        .send({ status, ...(status === 'shipped' ? { tracking: { carrier: 'Delhivery', trackingNumber: 'DLV123' } } : {}) })
        .expect(200);
    }
    const done = (await request(app).get(`${API}/user/orders/${order._id}`).set(user()).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'completed', payment: { status: 'paid' } });
    expect(done.items[0].tracking.trackingNumber).toBe('DLV123');
  });

  it('respects the COD toggle', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 1 }).expect(200);
    await settingsService.update('payments', { codEnabled: false }, { kind: 'system' });
    const res = await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'cod' }).expect(422);
    expect(res.body.error.code).toBe('COD_UNAVAILABLE');
    await settingsService.update('payments', { codEnabled: true }, { kind: 'system' });
  });
});

describe('razorpay', () => {
  it('is unavailable until the admin enables it', async () => {
    const res = await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'razorpay' }).expect(422);
    expect(res.body.error.code).toBe('PAYMENT_UNAVAILABLE');
  });

  it('verifies the checkout signature, then ignores a duplicate webhook', async () => {
    await settingsService.update('payments', { razorpayEnabled: true }, { kind: 'system' });
    const res = await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'razorpay' }).expect(201);
    const { order, payment } = res.body.data;
    expect(order.status).toBe('pending_payment');
    expect(payment).toMatchObject({ provider: 'razorpay', providerOrderId: 'order_test_1', amount: 649_900 + 10_000 });
    expect(await stockOf(product._id)).toBe(2);

    const forged = await request(app)
      .post(`${API}/user/orders/${order._id}/payment/verify`)
      .set(user())
      .send({ providerOrderId: payment.providerOrderId, paymentId: 'pay_1', signature: 'nope' })
      .expect(400);
    expect(forged.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');

    const signature = hmacSha256(KEY_SECRET, `${payment.providerOrderId}|pay_1`);
    const paid = await request(app)
      .post(`${API}/user/orders/${order._id}/payment/verify`)
      .set(user())
      .send({ providerOrderId: payment.providerOrderId, paymentId: 'pay_1', signature })
      .expect(200);
    expect(paid.body.data).toMatchObject({ status: 'placed', payment: { status: 'paid' } });

    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_1', order_id: payment.providerOrderId } } } });
    const send = () =>
      request(app)
        .post(`${API}/webhooks/razorpay`)
        .set('Content-Type', 'application/json')
        .set('X-Razorpay-Signature', hmacSha256(WEBHOOK_SECRET, body))
        .set('X-Razorpay-Event-Id', 'evt_1')
        .send(body);
    expect((await send().expect(200)).body.data).toEqual({ processed: true });
    expect((await send().expect(200)).body.data).toEqual({ duplicate: true });

    await request(app).post(`${API}/webhooks/razorpay`).set('Content-Type', 'application/json').set('X-Razorpay-Signature', 'bad').send(body).expect(400);
  });

  it('refunds a cancelled line on a paid order and restocks it', async () => {
    const order = (await Order.findOne({ 'payment.providerOrderId': 'order_test_1' }).lean());
    const before = await stockOf(product._id);
    const res = await request(app)
      .post(`${API}/user/orders/${order._id}/items/${order.items[0]._id}/cancel`)
      .set(user())
      .send({ reason: 'Ordered by mistake' })
      .expect(200);
    expect(res.body.data).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' }, amounts: { refunded: 659_900 } });
    expect(razorpay.refunds.at(-1)).toEqual({ paymentId: 'pay_1', amount: 659_900 });
    expect(await stockOf(product._id)).toBe(before + 1);
  });

  it('releases stock when the payment window lapses; a late webhook re-reserves it', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(user()).send({ quantity: 1 }).expect(200);
    const { order, payment } = (await request(app).post(`${API}/user/orders/checkout`).set(user()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)).body.data;
    const reserved = await stockOf(product._id);

    await Order.updateOne({ _id: order._id }, { expiresAt: new Date(Date.now() - 1000) });
    expect(await orderService.expireUnpaid()).toBe(1);
    expect(await stockOf(product._id)).toBe(reserved + 1);
    expect((await Order.findById(order._id).lean()).status).toBe('cancelled');

    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_late', order_id: payment.providerOrderId } } } });
    await request(app)
      .post(`${API}/webhooks/razorpay`)
      .set('Content-Type', 'application/json')
      .set('X-Razorpay-Signature', hmacSha256(WEBHOOK_SECRET, body))
      .send(body)
      .expect(200);
    const late = await Order.findById(order._id).lean();
    expect(late).toMatchObject({ status: 'placed', payment: { status: 'paid', providerPaymentId: 'pay_late' } });
    expect(await stockOf(product._id)).toBe(reserved);
  });
});

describe('dashboards', () => {
  it('reports vendor and admin stats', async () => {
    const v = (await request(app).get(`${API}/vendor/dashboard`).set(bearer(vendor.accessToken)).expect(200)).body.data;
    expect(v.productsByStatus.active).toBe(1);
    expect(v.dailySales).toHaveLength(14);

    const a = (await request(app).get(`${API}/admin/dashboard`).set(bearer(admin.accessToken)).expect(200)).body.data;
    expect(a.totals).toMatchObject({ users: 1, vendors: 1, products: 1 });
    expect(a.recentOrders.length).toBeGreaterThan(0);
  });
});
