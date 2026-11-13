import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '#core/utils/crypto.js';
import { walletService } from '#modules/wallet/wallet.service.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret';
function fakeRazorpay() {
  const real = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: 'wh' });
  let n = 0;
  const refunds = [];
  return {
    ...real,
    refunds,
    async createOrder({ amount, currency }) {
      n += 1;
      return { providerOrderId: `order_mr_${n}`, amount, currency, status: 'created' };
    },
    async refund(paymentId, { amount } = {}) {
      refunds.push({ paymentId, amount });
      return { refundId: `rfnd_mr_${refunds.length}`, amount, status: 'processed' };
    },
  };
}

let app;
let admin;
let buyer;
let product;
let addressId;
const razorpay = fakeRazorpay();
const U = () => bearer(buyer.accessToken);
const A = () => bearer(admin.accessToken);
const balance = async () => (await request(app).get(`${API}/user/wallet`).set(U()).expect(200)).body.meta.balance;
const adminOrder = async (id) => (await request(app).get(`${API}/admin/orders/${id}`).set(A()).expect(200)).body.data;

async function paidOnlineOrder(paymentId) {
  await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: 1 }).expect(200);
  const res = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)).body.data;
  await request(app)
    .post(`${API}/user/orders/${res.order._id}/payment/verify`)
    .set(U())
    .send({ providerOrderId: res.payment.providerOrderId, paymentId, signature: hmacSha256(KEY_SECRET, `${res.payment.providerOrderId}|${paymentId}`) })
    .expect(200);
  return res.order;
}

const cancel = (o) => request(app).post(`${API}/user/orders/${o._id}/items/${o.items[0]._id}/cancel`).set(U()).send({ reason: 'Changed my mind' }).expect(200);
const refund = (o, body, status = 200) => request(app).post(`${API}/admin/orders/${o._id}/refunds`).set(A()).send(body).expect(status);

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9820000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(A()).send({ name: 'Pumps' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({ type: 'tool', name: 'Water Pump', category: cat._id, pricing: { mrp: 300_000, price: 200_000, gstRate: 18 }, inventory: { stock: 20 }, hsnCode: '8413', publish: true })
      .expect(201)
  ).body.data;
  buyer = await otpSignIn(app, { phone: '9820000099', audience: 'user', register: { name: 'Refund Buyer' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U())
      .send({ name: 'R', phone: '9820000099', line1: 'Farm 2', city: 'Shamli', state: 'Uttar Pradesh', pincode: '247776' })
      .expect(201)
  ).body.data[0]._id;
  paymentService.useRazorpay(razorpay);
  await settingsService.update('payments', { razorpayEnabled: true, codEnabled: true, autoRefundOnCancel: false }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('manual refunds (auto refund off)', () => {
  it('cancelling refunds nothing; the admin sees what is owed and refunds any amount up to it', async () => {
    const o = await paidOnlineOrder('pay_mr_1');
    const before = razorpay.refunds.length;
    await cancel(o);
    expect(razorpay.refunds.length).toBe(before);

    let detail = await adminOrder(o._id);
    expect(detail.items[0].refunded).toBe(false);
    expect(detail.payment.status).toBe('paid');
    expect(detail.refundSummary).toMatchObject({ paid: 200_000, refunded: 0, refundable: 200_000, suggested: 200_000, gatewayRefundable: 200_000 });

    // A custom amount, back to the original payment.
    detail = (await refund(o, { amount: 150_000, method: 'gateway', note: 'Kept the box' })).body.data;
    expect(razorpay.refunds.at(-1)).toEqual({ paymentId: 'pay_mr_1', amount: 150_000 });
    expect(detail.payment.status).toBe('partially_refunded');
    expect(detail.refunds.at(-1)).toMatchObject({ amount: 150_000, method: 'gateway', manual: true, note: 'Kept the box' });
    expect(detail.refundSummary).toMatchObject({ refunded: 150_000, refundable: 50_000 });

    // Never more than what's left.
    await refund(o, { amount: 60_000, method: 'offline' }, 422);

    // The rest was paid out in cash.
    detail = (await refund(o, { amount: 50_000, method: 'offline', note: 'UPI from office' })).body.data;
    expect(detail.payment.status).toBe('refunded');
    expect(detail.refundSummary.refundable).toBe(0);

    // The buyer sees the refunds, but not the admin's notes.
    const mine = (await request(app).get(`${API}/user/orders/${o._id}`).set(U()).expect(200)).body.data;
    expect(mine.refunds).toHaveLength(2);
    expect(mine.refunds[0].note).toBeUndefined();
  });

  it('refunds to the wallet; wallet-paid orders keep their money until the admin refunds', async () => {
    await walletService.credit(buyer.account._id, 200_000, { reason: 'admin_credit' });
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: 1 }).expect(200);
    const { order } = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod', useWallet: true }).expect(201)).body.data;
    expect(order.payment.method).toBe('wallet');
    expect(await balance()).toBe(0);

    await cancel(order);
    expect(await balance()).toBe(0);
    expect((await adminOrder(order._id)).refundSummary).toMatchObject({ suggested: 200_000, gatewayRefundable: 0 });

    await refund(order, { amount: 200_000, method: 'gateway' }, 422); // nothing was paid online
    await refund(order, { amount: 180_000, method: 'wallet' });
    expect(await balance()).toBe(180_000);
  });

  it('refunds straight away again once auto refund is back on', async () => {
    await settingsService.update('payments', { autoRefundOnCancel: true }, { kind: 'system' });
    const o = await paidOnlineOrder('pay_mr_3');
    await cancel(o);
    expect(razorpay.refunds.at(-1)).toEqual({ paymentId: 'pay_mr_3', amount: 200_000 });
    expect((await adminOrder(o._id)).refundSummary).toMatchObject({ refundable: 0, suggested: 0 });
  });
});
