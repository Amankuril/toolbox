import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hmacSha256 } from '#core/utils/crypto.js';
import { Order } from '#modules/orders/order.model.js';
import { Product } from '#modules/products/product.model.js';
import { createRazorpayProvider } from '#services/payment/providers/razorpay.provider.js';
import { paymentService } from '#services/payment/payment.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

const KEY_SECRET = 'rzp_test_secret';

function fakeRazorpay() {
  const real = createRazorpayProvider({ keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: 'whsec' });
  let n = 0;
  return {
    ...real,
    async createOrder({ amount, currency }) {
      n += 1;
      return { providerOrderId: `order_link_${n}`, amount, currency, status: 'created' };
    },
  };
}

let app;
let admin;
let vendor;
let otherVendor;
let product;
let otherProduct;

const address = { line1: '4 Mandi Road', city: 'Budhana', state: 'Uttar Pradesh', pincode: '251309' };
const stockOf = async (id) => (await Product.findById(id).lean()).inventory.stock;

async function makeProduct(token, name, cat) {
  return (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(token))
      .send({ type: 'tool', name, category: cat, pricing: { mrp: 200_000, price: 150_000, gstRate: 18 }, inventory: { stock: 10 }, hsnCode: '8467', publish: true })
      .expect(201)
  ).body.data;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9300000001' });
  otherVendor = await approvedVendor(app, admin.accessToken, { phone: '9300000002', storeName: 'Other Tools', gstin: '29AAPFU0939F1ZT', pan: 'AAPFU0939F' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Drills' }).expect(201)).body.data;
  product = await makeProduct(vendor.accessToken, 'Bosch Drill', cat._id);
  otherProduct = await makeProduct(otherVendor.accessToken, 'Makita Drill', cat._id);
  paymentService.useRazorpay(fakeRazorpay());
  await settingsService.update('payments', { razorpayEnabled: true }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('manual orders', () => {
  it('admin places an order for a new customer with a discount and delivery fee', async () => {
    const res = await request(app)
      .post(`${API}/admin/manual-orders`)
      .set(bearer(admin.accessToken))
      .send({
        mode: 'create',
        customer: { phone: '9811111111', name: 'Ramesh' },
        address,
        items: [{ product: product._id, quantity: 2 }],
        discount: 10_000,
        deliveryFee: 5_000,
      })
      .expect(201);
    const { order } = res.body.data;
    expect(order).toMatchObject({
      status: 'placed',
      payment: { method: 'cod', status: 'pending' },
      amounts: { subtotal: 300_000, discount: 10_000, shipping: 5_000, total: 295_000 },
      shippingAddress: { name: 'Ramesh', phone: '+919811111111', city: 'Budhana' },
    });
    expect(order.items[0]).toMatchObject({ quantity: 2, discount: 10_000, lineTotal: 290_000 });
    expect(await stockOf(product._id)).toBe(8);
    expect((await Order.findById(order._id).lean()).source).toBe('manual');

    const lookup = await request(app).get(`${API}/admin/manual-orders/customer?phone=9811111111`).set(bearer(admin.accessToken)).expect(200);
    expect(lookup.body.data).toMatchObject({ found: true, name: 'Ramesh' });
  });

  it('a seller can only order their own products, and the order shows in their list', async () => {
    const base = { mode: 'create', customer: { phone: '9822222222', name: 'Suresh' }, address, paymentMethod: 'offline' };
    await request(app)
      .post(`${API}/vendor/manual-orders`)
      .set(bearer(vendor.accessToken))
      .send({ ...base, items: [{ product: otherProduct._id, quantity: 1 }] })
      .expect(422);
    const { order } = (
      await request(app)
        .post(`${API}/vendor/manual-orders`)
        .set(bearer(vendor.accessToken))
        .send({ ...base, items: [{ product: product._id, quantity: 1, unitPrice: 140_000 }] })
        .expect(201)
    ).body.data;
    expect(order).toMatchObject({ payment: { method: 'offline', status: 'paid' }, amounts: { total: 140_000 } });
    const list = await request(app).get(`${API}/vendor/orders`).set(bearer(vendor.accessToken)).expect(200);
    expect(list.body.data.map((o) => o._id)).toContain(order._id);
  });

  it('rejects a discount above the order value', async () => {
    await request(app)
      .post(`${API}/admin/manual-orders`)
      .set(bearer(admin.accessToken))
      .send({ mode: 'create', customer: { phone: '9811111111', name: 'Ramesh' }, address, items: [{ product: product._id, quantity: 1 }], discount: 999_999 })
      .expect(422);
  });
});

describe('shared order links', () => {
  let link;
  const token = () => link.url.split('/pay/')[1];

  it('makes a link without taking stock', async () => {
    link = (
      await request(app)
        .post(`${API}/vendor/manual-orders`)
        .set(bearer(vendor.accessToken))
        .send({ mode: 'share', customer: { phone: '9833333333', name: 'Mahesh' }, address, items: [{ product: product._id, quantity: 3 }], deliveryFee: 10_000 })
        .expect(201)
    ).body.data.link;
    expect(link).toMatchObject({ status: 'open', amounts: { subtotal: 450_000, shipping: 10_000, total: 460_000 } });
    expect(await stockOf(product._id)).toBe(7);

    const view = (await request(app).get(`${API}/public/pay/${token()}`).expect(200)).body.data;
    expect(view).toMatchObject({ status: 'open', customerName: 'Mahesh', sellers: ['Acme Tools'], amounts: { total: 460_000 } });
    expect(view.shippingAddress.phone).toMatch(/•+3333$/);
  });

  it('the customer pays without signing in and the order is placed', async () => {
    const start = (await request(app).post(`${API}/public/pay/${token()}/start`).expect(200)).body.data;
    expect(start.payment).toMatchObject({ amount: 460_000, providerOrderId: expect.stringMatching(/^order_link_/) });
    expect(await stockOf(product._id)).toBe(4);

    // Opening it again resumes the same payment instead of reserving twice.
    const again = (await request(app).post(`${API}/public/pay/${token()}/start`).expect(200)).body.data;
    expect(again.orderId).toBe(start.orderId);
    expect(await stockOf(product._id)).toBe(4);

    const paymentId = 'pay_link_1';
    const signature = hmacSha256(KEY_SECRET, `${start.payment.providerOrderId}|${paymentId}`);
    const paid = (
      await request(app)
        .post(`${API}/public/pay/${token()}/verify`)
        .send({ providerOrderId: start.payment.providerOrderId, paymentId, signature })
        .expect(200)
    ).body.data;
    expect(paid.status).toBe('paid');
    expect(paid.orderNumber).toMatch(/^TB/);

    const order = await Order.findById(start.orderId).lean();
    expect(order).toMatchObject({ status: 'placed', source: 'link', payment: { status: 'paid' } });
    await request(app).post(`${API}/public/pay/${token()}/start`).expect(409);

    const links = (await request(app).get(`${API}/vendor/manual-orders/links`).set(bearer(vendor.accessToken)).expect(200)).body.data;
    expect(links[0]).toMatchObject({ status: 'paid', order: { orderNumber: paid.orderNumber } });
    // Another seller doesn't see it.
    const others = (await request(app).get(`${API}/vendor/manual-orders/links`).set(bearer(otherVendor.accessToken)).expect(200)).body.data;
    expect(others).toHaveLength(0);
  });

  it('a cancelled link can no longer be paid', async () => {
    const fresh = (
      await request(app)
        .post(`${API}/admin/manual-orders`)
        .set(bearer(admin.accessToken))
        .send({ mode: 'share', customer: { phone: '9833333333', name: 'Mahesh' }, address, items: [{ product: otherProduct._id, quantity: 1 }] })
        .expect(201)
    ).body.data.link;
    await request(app).post(`${API}/admin/manual-orders/links/${fresh._id}/cancel`).set(bearer(admin.accessToken)).expect(200);
    await request(app).post(`${API}/public/pay/${fresh.url.split('/pay/')[1]}/start`).expect(409);
  });
});

describe('cash collected', () => {
  it('admin marks a cash on delivery order paid, once', async () => {
    const { order } = (
      await request(app)
        .post(`${API}/admin/manual-orders`)
        .set(bearer(admin.accessToken))
        .send({ mode: 'create', customer: { phone: '9844444444', name: 'Naresh' }, address, items: [{ product: otherProduct._id, quantity: 1 }] })
        .expect(201)
    ).body.data;
    const paid = (await request(app).post(`${API}/admin/orders/${order._id}/cash-collected`).set(bearer(admin.accessToken)).send({}).expect(200)).body.data;
    expect(paid.payment).toMatchObject({ status: 'paid', cashCollected: { amount: 150_000 } });
    await request(app).post(`${API}/admin/orders/${order._id}/cash-collected`).set(bearer(admin.accessToken)).send({}).expect(409);
  });
});
