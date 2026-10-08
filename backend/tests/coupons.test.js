import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '#core/utils/crypto.js';
import { Coupon } from '#modules/coupons/coupon.model.js';
import { Order } from '#modules/orders/order.model.js';
import { orderService } from '#modules/orders/order.service.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret';
const refunds = [];
let orderCount = 0;
const razorpay = {
  ...createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: 'rzp_webhook_secret' }),
  async createOrder({ amount, currency }) {
    orderCount += 1;
    return { providerOrderId: `order_cpn_${orderCount}`, amount, currency, status: 'created' };
  },
  async refund(paymentId, { amount } = {}) {
    refunds.push({ paymentId, amount });
    return { refundId: `rfnd_${refunds.length}`, amount, status: 'processed' };
  },
  async fetchOrderPayments() {
    return [];
  },
};

let app;
let sellerA;
let sellerB;
let drill; // seller A, ₹5,000
let saw; // seller B, ₹2,000
let buyer;
let buyer2;
let addressId;
let address2;

async function product(seller, cat, name, price) {
  return (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(seller.accessToken))
      .send({
        type: 'tool',
        name,
        category: cat._id,
        pricing: { mrp: price + 50_000, price, gstRate: 18 },
        inventory: { stock: 50, moq: 1 },
        hsnCode: '8467',
        publish: true,
      })
      .expect(201)
  ).body.data;
}

async function address(customer, phone) {
  const res = await request(app)
    .post(`${API}/user/addresses`)
    .set(bearer(customer.accessToken))
    .send({ name: 'Buyer', phone, line1: 'Plot 4, MIDC', city: 'Pune', state: 'Maharashtra', pincode: '411001' })
    .expect(201);
  return res.body.data[0]._id;
}

const A = () => bearer(sellerA.accessToken);
const U = () => bearer(buyer.accessToken);
const cart = (who, qtyDrill, qtySaw) =>
  Promise.all([
    request(app).put(`${API}/user/cart/items/${drill._id}`).set(who).send({ quantity: qtyDrill }).expect(200),
    qtySaw ? request(app).put(`${API}/user/cart/items/${saw._id}`).set(who).send({ quantity: qtySaw }).expect(200) : null,
  ]);
const coupon = (body, seller = A()) => request(app).post(`${API}/vendor/coupons`).set(seller).send(body);

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  sellerA = await approvedVendor(app, admin.accessToken, { phone: '9500000001', storeName: 'Alpha Tools' });
  sellerB = await approvedVendor(app, admin.accessToken, {
    phone: '9500000002',
    storeName: 'Beta Tools',
    gstin: '29AABCB1234C1Z5',
    pan: 'AABCB1234C',
  });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Power Tools' }).expect(201))
    .body.data;
  drill = await product(sellerA, cat, 'Alpha Impact Drill', 500_000);
  saw = await product(sellerB, cat, 'Beta Circular Saw', 200_000);

  buyer = await otpSignIn(app, { phone: '9500000099', audience: 'user', register: { name: 'Coupon Buyer' } });
  buyer2 = await otpSignIn(app, { phone: '9500000098', audience: 'user', register: { name: 'Second Buyer' } });
  addressId = await address(buyer, '9500000099');
  address2 = await address(buyer2, '9500000098');

  paymentService.useRazorpay(razorpay);
  await settingsService.update('payments', { razorpayEnabled: true, codEnabled: true }, { kind: 'system' });
  await settingsService.update('shipping', { flatFee: 0, freeAbove: 0 }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('seller coupons', () => {
  it('creates coupons with unique codes and sane values, and keeps them private to their seller', async () => {
    const created = (await coupon({ code: 'alpha10', type: 'percent', value: 10, maxDiscount: 60_000 }).expect(201)).body.data;
    expect(created).toMatchObject({ code: 'ALPHA10', state: 'live', usedCount: 0 });
    expect((await coupon({ code: 'ALPHA10', type: 'flat', value: 100 }, bearer(sellerB.accessToken)).expect(409)).body.error.code).toBe(
      'DUPLICATE_CODE',
    );
    await coupon({ code: 'TOOMUCH', type: 'percent', value: 95 }).expect(422);
    await coupon({ code: 'BADCAP', type: 'flat', value: 100, maxDiscount: 50 }).expect(422);
    await request(app).get(`${API}/vendor/coupons/${created._id}`).set(bearer(sellerB.accessToken)).expect(404);
    await request(app).patch(`${API}/vendor/coupons/${created._id}`).set(bearer(sellerB.accessToken)).send({ value: 50 }).expect(404);
  });
});

describe('applying coupons', () => {
  it("discounts only the coupon seller's lines, capped, and spreads it over them", async () => {
    await cart(U(), 2, 1); // ₹10,000 from A, ₹2,000 from B
    const data = (await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'alpha10' }).expect(200)).body.data;
    // 10% of ₹10,000 = ₹1,000, capped at ₹600; B's saw gets nothing.
    expect(data.coupon).toMatchObject({ code: 'ALPHA10', discount: 60_000, issue: null });
    expect(data.summary).toMatchObject({ subtotal: 1_200_000, discount: 60_000, total: 1_140_000 });
    expect(data.items.find((i) => String(i.productId) === String(drill._id)).discount).toBe(60_000);
    expect(data.items.find((i) => String(i.productId) === String(saw._id)).discount).toBe(0);
    expect(data.coupon).not.toHaveProperty('_coupon');
  });

  it('refuses unknown codes, codes below their minimum, and codes for other sellers', async () => {
    expect((await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'NOPE99' }).expect(422)).body.error.code).toBe(
      'COUPON_INVALID',
    );
    await coupon({ code: 'BIGSPEND', type: 'flat', value: 50_000, minOrderValue: 5_000_000 }).expect(201);
    const below = (await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'BIGSPEND' }).expect(422)).body.error;
    expect(below.details.issue).toBe('below_min');
    await coupon({ code: 'BETAONLY', type: 'flat', value: 10_000 }, bearer(sellerB.accessToken)).expect(201);
    await request(app).delete(`${API}/user/cart/items/${saw._id}`).set(U()).expect(200);
    expect(
      (await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'BETAONLY' }).expect(422)).body.error.details.issue,
    ).toBe('no_items');
  });
});

describe('checkout with a coupon', () => {
  it('records the discount on the order and its lines, uses the coupon once, and clears it from the cart', async () => {
    await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'ALPHA10' }).expect(200);
    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod' }).expect(201)
    ).body.data;
    expect(order.amounts).toMatchObject({ subtotal: 1_000_000, discount: 60_000, total: 940_000 });
    expect(order.coupon).toMatchObject({ code: 'ALPHA10' });
    expect(order.items[0]).toMatchObject({ lineTotal: 940_000, discount: 60_000 });
    expect((await Coupon.findOne({ code: 'ALPHA10' }).lean()).usedCount).toBe(1);

    const after = (await request(app).get(`${API}/user/cart`).set(U()).expect(200)).body.data;
    expect(after.coupon).toBeNull();

    // The seller sees what they're paid for (net of their coupon).
    const seen = (await request(app).get(`${API}/vendor/orders/${order._id}`).set(A()).expect(200)).body.data;
    expect(seen.amounts).toMatchObject({ subtotal: 940_000, discount: 60_000 });

    // Once per buyer by default.
    await cart(U(), 1);
    expect(
      (await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'ALPHA10' }).expect(422)).body.error.details.issue,
    ).toBe('already_used');
  });

  it('stops at the usage limit, and gives the use back when an online order is never paid', async () => {
    await coupon({ code: 'ONEONLY', type: 'flat', value: 20_000, usageLimit: 1 }).expect(201);
    await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'ONEONLY' }).expect(200);
    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)
    ).body.data;
    expect(order.amounts.discount).toBe(20_000);

    const B2 = bearer(buyer2.accessToken);
    await cart(B2, 1);
    expect((await request(app).put(`${API}/user/cart/coupon`).set(B2).send({ code: 'ONEONLY' }).expect(422)).body.error.details.issue).toBe(
      'limit_reached',
    );

    await Order.updateOne({ _id: order._id }, { expiresAt: new Date(Date.now() - 1000) });
    await orderService.expireUnpaid();
    expect((await Coupon.findOne({ code: 'ONEONLY' }).lean()).usedCount).toBe(0);
    await request(app).put(`${API}/user/cart/coupon`).set(B2).send({ code: 'ONEONLY' }).expect(200);
    const placed = (
      await request(app).post(`${API}/user/orders/checkout`).set(B2).send({ addressId: address2, paymentMethod: 'cod' }).expect(201)
    ).body.data.order;
    expect(placed.amounts.discount).toBe(20_000);
  });

  it('blocks checkout when the applied coupon stopped being valid', async () => {
    await coupon({ code: 'SHORTLIVED', type: 'flat', value: 10_000 }).expect(201);
    await cart(U(), 1);
    await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'SHORTLIVED' }).expect(200);
    await Coupon.updateOne({ code: 'SHORTLIVED' }, { expiresAt: new Date(Date.now() - 1000) });
    const view = (await request(app).get(`${API}/user/cart`).set(U()).expect(200)).body.data;
    expect(view.coupon).toMatchObject({ issue: 'expired', discount: 0 });
    expect(view.summary.discount).toBe(0);
    const res = await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod' }).expect(409);
    expect(res.body.error.code).toBe('COUPON_INVALID');
    await request(app).delete(`${API}/user/cart/coupon`).set(U()).expect(200);
  });

  it('refunds what was actually paid when a discounted line is cancelled', async () => {
    await coupon({ code: 'FLAT500', type: 'flat', value: 50_000 }).expect(201);
    await cart(U(), 1);
    await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'FLAT500' }).expect(200);
    const { order, payment } = (
      await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'razorpay' }).expect(201)
    ).body.data;
    expect(payment.amount).toBe(450_000);
    await request(app)
      .post(`${API}/user/orders/${order._id}/payment/verify`)
      .set(U())
      .send({
        providerOrderId: payment.providerOrderId,
        paymentId: 'pay_cpn',
        signature: hmacSha256(KEY_SECRET, `${payment.providerOrderId}|pay_cpn`),
      })
      .expect(200);
    const before = refunds.length;
    await request(app).post(`${API}/user/orders/${order._id}/items/${order.items[0]._id}/cancel`).set(U()).send({}).expect(200);
    expect(refunds.slice(before)).toEqual([{ paymentId: 'pay_cpn', amount: 450_000 }]);
  });
});

describe('editing used coupons', () => {
  it("won't change a used coupon's code or discount, and switches it off instead of deleting it", async () => {
    const used = await Coupon.findOne({ code: 'ALPHA10' }).lean();
    expect((await request(app).patch(`${API}/vendor/coupons/${used._id}`).set(A()).send({ value: 20 }).expect(409)).body.error.code).toBe(
      'COUPON_IN_USE',
    );
    await request(app).patch(`${API}/vendor/coupons/${used._id}`).set(A()).send({ description: 'Festive offer' }).expect(200);
    expect((await request(app).delete(`${API}/vendor/coupons/${used._id}`).set(A()).expect(200)).body.data).toEqual({
      deleted: false,
      deactivated: true,
    });
    const list = (await request(app).get(`${API}/vendor/coupons?status=usable`).set(A()).expect(200)).body.data;
    expect(list.map((c) => c.code)).not.toContain('ALPHA10');
  });
});
