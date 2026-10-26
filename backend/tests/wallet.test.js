import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '#core/utils/crypto.js';
import { Order } from '#modules/orders/order.model.js';
import { orderService } from '#modules/orders/order.service.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret';
const WEBHOOK_SECRET = 'rzp_wh_secret';
function fakeRazorpay() {
  const real = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET });
  let n = 0;
  const refunds = [];
  return {
    ...real,
    refunds,
    async createOrder({ amount, currency }) {
      n += 1;
      return { providerOrderId: `order_w_${n}`, amount, currency, status: 'created' };
    },
    async refund(paymentId, { amount } = {}) {
      refunds.push({ paymentId, amount });
      return { refundId: `rfnd_${refunds.length}`, amount, status: 'processed' };
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
const balance = async () => (await request(app).get(`${API}/user/wallet`).set(U()).expect(200)).body.meta.balance;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9800000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Sprayers' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({ type: 'tool', name: 'Knapsack Sprayer', category: cat._id, pricing: { mrp: 300_000, price: 200_000, gstRate: 18 }, inventory: { stock: 20 }, hsnCode: '8424', publish: true })
      .expect(201)
  ).body.data;
  buyer = await otpSignIn(app, { phone: '9800000099', audience: 'user', register: { name: 'Wallet Buyer' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U())
      .send({ name: 'W', phone: '9800000099', line1: 'Farm 1', city: 'Shamli', state: 'Uttar Pradesh', pincode: '247776' })
      .expect(201)
  ).body.data[0]._id;
  paymentService.useRazorpay(razorpay);
  await settingsService.update('payments', { razorpayEnabled: true, codEnabled: true }, { kind: 'system' });
});
afterAll(stopTestApp);

const addToCart = (qty) => request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity: qty }).expect(200);

describe('wallet', () => {
  it('tops up through the gateway, once even if the webhook also arrives', async () => {
    const start = (await request(app).post(`${API}/user/wallet/topup`).set(U()).send({ amount: 150_000 }).expect(200)).body.data;
    const paymentId = 'pay_topup_1';
    const signature = hmacSha256(KEY_SECRET, `${start.providerOrderId}|${paymentId}`);
    await request(app).post(`${API}/user/wallet/topup/verify`).set(U()).send({ providerOrderId: start.providerOrderId, paymentId, signature }).expect(200);
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: paymentId, order_id: start.providerOrderId } } } });
    await request(app)
      .post(`${API}/webhooks/razorpay`)
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', hmacSha256(WEBHOOK_SECRET, body))
      .set('x-razorpay-event-id', 'evt_topup_1')
      .send(body)
      .expect(200);
    expect(await balance()).toBe(150_000);
  });

  it('admins credit and debit with a note; a debit can’t go below zero', async () => {
    const A = bearer(admin.accessToken);
    await request(app).post(`${API}/admin/wallets/${buyer.account._id}`).set(A).send({ type: 'credit', amount: 100_000, note: 'Goodwill' }).expect(200);
    await request(app).post(`${API}/admin/wallets/${buyer.account._id}`).set(A).send({ type: 'debit', amount: 999_999_00 }).expect(409);
    expect(await balance()).toBe(250_000);
  });

  it('pays a whole order from the wallet and refunds it there on cancel', async () => {
    await addToCart(1);
    const { order } = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod', useWallet: true }).expect(201)).body.data;
    expect(order).toMatchObject({ status: 'placed', payment: { method: 'wallet', status: 'paid' }, amounts: { wallet: 200_000 } });
    expect(await balance()).toBe(50_000);
    await request(app).post(`${API}/user/orders/${order._id}/items/${order.items[0]._id}/cancel`).set(U()).send({}).expect(200);
    expect(await balance()).toBe(250_000);
    expect((await Order.findById(order._id).lean()).payment.status).toBe('refunded');
  });

  it('wallet + cash on delivery: the courier collects only the rest', async () => {
    await request(app).post(`${API}/admin/wallets/${buyer.account._id}`).set(bearer(admin.accessToken)).send({ type: 'debit', amount: 200_000 }).expect(200);
    await addToCart(2);
    const { order } = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod', useWallet: true }).expect(201)).body.data;
    expect(order).toMatchObject({ payment: { method: 'cod' }, amounts: { total: 400_000, wallet: 50_000, balanceDue: 350_000 } });
    expect(await balance()).toBe(0);
  });

  it('wallet + online: the gateway charges the rest; an unpaid order gives the wallet back', async () => {
    await request(app).post(`${API}/admin/wallets/${buyer.account._id}`).set(bearer(admin.accessToken)).send({ type: 'credit', amount: 50_000 }).expect(200);
    await addToCart(1);
    const res = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'razorpay', useWallet: true }).expect(201)).body.data;
    expect(res.payment.amount).toBe(150_000);
    expect(await balance()).toBe(0);
    await orderService.expireUnpaid(new Date(Date.now() + 24 * 60 * 60_000));
    expect(await balance()).toBe(50_000);
  });

  it('wallet + online, paid: a cancel refunds the wallet part first, then the card', async () => {
    await addToCart(2);
    const res = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'razorpay', useWallet: true }).expect(201)).body.data;
    expect(res.payment.amount).toBe(350_000);
    const paymentId = 'pay_order_w';
    await request(app)
      .post(`${API}/user/orders/${res.order._id}/payment/verify`)
      .set(U())
      .send({ providerOrderId: res.payment.providerOrderId, paymentId, signature: hmacSha256(KEY_SECRET, `${res.payment.providerOrderId}|${paymentId}`) })
      .expect(200);
    await request(app).post(`${API}/user/orders/${res.order._id}/items/${res.order.items[0]._id}/cancel`).set(U()).send({}).expect(200);
    expect(await balance()).toBe(50_000);
    expect(razorpay.refunds.at(-1)).toEqual({ paymentId, amount: 350_000 });
  });
});
