import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Order } from '#modules/orders/order.model.js';
import { allocate, splitPartial } from '#modules/orders/partialPayment.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let vendor;
let customer;
let pump;
let hose;
let addressId;
const gateway = { created: [], refunds: [] };

const U = () => bearer(customer.accessToken);
const payments = (v) => settingsService.update('payments', v, { kind: 'system' });

async function checkout(lines, status = 201) {
  for (const [p, q] of lines) await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: q }).expect(200);
  return request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'partial' }).expect(status);
}

async function pay(order) {
  const doc = await Order.findById(order._id);
  await paymentService.markPaid({ providerOrderId: doc.payment.providerOrderId, paymentId: `pay_${order._id}` });
  return Order.findById(order._id).lean();
}

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9800000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Pumps' }).expect(201)).body
    .data;
  const make = async (name, price) =>
    (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(bearer(vendor.accessToken))
        .send({
          type: 'machinery',
          name,
          category: cat._id,
          pricing: { mrp: price, price, gstRate: 18 },
          hsnCode: '8413',
          inventory: { stock: 50, moq: 1 },
          publish: true,
        })
        .expect(201)
    ).body.data;
  pump = await make('Diesel pump 5HP', 4_000_000);
  hose = await make('Suction hose 20m', 1_000_000);

  customer = await otpSignIn(app, { phone: '9800000099', audience: 'user', register: { name: 'Kisan' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U())
      .send({ name: 'Kisan', phone: '9800000099', line1: 'Farm 9', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
      .expect(201)
  ).body.data[0]._id;

  const real = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: 'rzp_test_secret', webhookSecret: 'rzp_webhook_secret' });
  paymentService.useRazorpay({
    ...real,
    async createOrder({ amount, currency }) {
      gateway.created.push(amount);
      return { providerOrderId: `order_partial_${gateway.created.length}`, amount, currency, status: 'created' };
    },
    async refund(paymentId, { amount } = {}) {
      gateway.refunds.push(amount);
      return { refundId: `rfnd_p_${gateway.refunds.length}`, amount, status: 'processed' };
    },
  });
  await settingsService.update('shipping', { flatFee: 0, freeAbove: 0 }, { kind: 'system' });
  await payments({
    razorpayEnabled: true,
    codEnabled: true,
    partialEnabled: true,
    partialAdvancePercent: 20,
    partialMinOrderValue: 0,
    partialMaxBalance: 0,
  });
});
afterAll(stopTestApp);

describe('split maths', () => {
  it('rounds the advance up to a whole rupee and allocates exactly', () => {
    expect(splitPartial(1_234_567, 20)).toEqual({ advance: 247_000, balanceDue: 987_567 });
    expect(splitPartial(50, 20)).toEqual({ advance: 50, balanceDue: 0 });
    const parts = allocate(1001, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1001);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });
});

describe('advance + balance on delivery', () => {
  it('charges only the advance online and records the balance for the courier', async () => {
    const res = await checkout([[pump, 1]], 201);
    const { order, payment } = res.body.data;
    expect(order.amounts).toMatchObject({ total: 4_000_000, advance: 800_000, balanceDue: 3_200_000 });
    expect(order.status).toBe('pending_payment');
    expect(payment.amount).toBe(800_000);
    expect(gateway.created.at(-1)).toBe(800_000);

    const paid = await pay(order);
    expect(paid).toMatchObject({ status: 'placed', payment: { method: 'partial', status: 'partially_paid' } });
    expect((await request(app).get(`${API}/user/cart`).set(U())).body.data.items).toHaveLength(0);
  });

  it('marks the order paid when the courier delivers (balance collected)', async () => {
    const { order } = (await checkout([[pump, 1]], 201)).body.data;
    await pay(order);
    const V = bearer(vendor.accessToken);
    for (const status of ['confirmed', 'shipped', 'delivered']) {
      await request(app).patch(`${API}/vendor/orders/${order._id}/items/${order.items[0]._id}`).set(V).send({ status }).expect(200);
    }
    expect(await Order.findById(order._id).lean()).toMatchObject({
      status: 'completed',
      payment: { status: 'paid' },
      amounts: { balanceDue: 0 },
    });
  });

  it('cancelling lowers the balance first, and refunds only what the advance over-covers', async () => {
    const { order } = (
      await checkout(
        [
          [pump, 1],
          [hose, 1],
        ],
        201,
      )
    ).body.data;
    expect(order.amounts).toMatchObject({ total: 5_000_000, advance: 1_000_000, balanceDue: 4_000_000 });
    await pay(order);
    const [pumpLine, hoseLine] = [
      order.items.find((i) => String(i.product) === pump._id),
      order.items.find((i) => String(i.product) === hose._id),
    ];
    const refundsBefore = gateway.refunds.length;

    // Still owed ₹10,000 for the hose: the ₹10,000 advance covers it exactly, so no refund, nothing due.
    await request(app).post(`${API}/user/orders/${order._id}/items/${pumpLine._id}/cancel`).set(U()).send({}).expect(200);
    let saved = await Order.findById(order._id).lean();
    expect(saved.amounts).toMatchObject({ balanceDue: 0, refunded: 0 });
    expect(saved.payment.status).toBe('paid');
    expect(gateway.refunds.length).toBe(refundsBefore);

    // Nothing left: the whole advance comes back.
    await request(app).post(`${API}/user/orders/${order._id}/items/${hoseLine._id}/cancel`).set(U()).send({}).expect(200);
    saved = await Order.findById(order._id).lean();
    expect(gateway.refunds.at(-1)).toBe(1_000_000);
    expect(saved).toMatchObject({ status: 'cancelled', payment: { status: 'refunded' }, amounts: { refunded: 1_000_000 } });
  });

  it('enforces the admin limits and the on/off switch', async () => {
    await payments({ partialMinOrderValue: 5_000_000 });
    expect((await checkout([[hose, 1]], 422)).body.error.code).toBe('PARTIAL_MIN_ORDER');
    await payments({ partialMinOrderValue: 0, partialMaxBalance: 500_000 });
    expect((await checkout([[hose, 1]], 422)).body.error.code).toBe('PARTIAL_LIMIT');
    await payments({ partialMaxBalance: 0, partialEnabled: false });
    expect((await checkout([[hose, 1]], 422)).body.error.code).toBe('PARTIAL_UNAVAILABLE');
    const pub = (await request(app).get(`${API}/public/settings`).expect(200)).body.data.payments;
    expect(pub.partialEnabled).toBe(false);
    await payments({ partialEnabled: true, razorpayEnabled: false });
    expect((await request(app).get(`${API}/public/settings`).expect(200)).body.data.payments.partialEnabled).toBe(false);
    await payments({ razorpayEnabled: true });
  });
});
