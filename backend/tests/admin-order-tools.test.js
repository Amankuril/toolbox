import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Invoice } from '#modules/invoices/invoice.model.js';
import { Order } from '#modules/orders/order.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;
let customer;
let products;
let addressId;

const A = () => bearer(admin.accessToken);
const U = () => bearer(customer.accessToken);

/** A COD order with one line per product, every line confirmed. */
async function placeOrder() {
  for (const p of products) await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: 1 }).expect(200);
  const order = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod' }).expect(201)).body
    .data.order;
  for (const item of order.items) {
    await request(app).patch(`${API}/admin/orders/${order._id}/items/${item._id}`).set(A()).send({ status: 'confirmed' }).expect(200);
  }
  return order;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9500000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(A()).send({ name: 'Drills' }).expect(201)).body.data;
  products = [];
  for (const name of ['Impact Drill', 'Angle Grinder', 'Heat Gun']) {
    const body = {
      type: 'tool',
      name,
      category: cat._id,
      pricing: { mrp: 500_000, price: 400_000, gstRate: 18 },
      hsnCode: '8467',
      inventory: { stock: 20, moq: 1 },
      publish: true,
    };
    products.push((await request(app).post(`${API}/vendor/products`).set(bearer(vendor.accessToken)).send(body).expect(201)).body.data);
  }
  customer = await otpSignIn(app, { phone: '9500000099', audience: 'user', register: { name: 'Meera' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U())
      .send({ name: 'Meera', phone: '9500000099', line1: 'Shop 2', city: 'Pune', state: 'Maharashtra', pincode: '411001' })
      .expect(201)
  ).body.data[0]._id;
});
afterAll(stopTestApp);

describe('ship several items at once', () => {
  it('applies one tracking number to every item, or a different one to each', async () => {
    const order = await placeOrder();
    const [a, b, c] = order.items;
    const same = { carrier: 'Delhivery', trackingNumber: 'DLV-ALL' };
    let res = (
      await request(app)
        .post(`${API}/admin/orders/${order._id}/ship`)
        .set(A())
        .send({ items: [a, b].map((i) => ({ itemId: i._id, tracking: same })) })
        .expect(200)
    ).body.data;
    const byId = (list) => Object.fromEntries(list.items.map((i) => [i._id, i]));
    expect(byId(res)[a._id]).toMatchObject({ status: 'shipped', tracking: same });
    expect(byId(res)[b._id]).toMatchObject({ status: 'shipped', tracking: same });
    expect(byId(res)[c._id].status).toBe('confirmed');

    // Separate numbers, and a correction to an item that has already shipped. The seller can do it too.
    res = (
      await request(app)
        .post(`${API}/vendor/orders/${order._id}/ship`)
        .set(bearer(vendor.accessToken))
        .send({
          items: [
            { itemId: b._id, tracking: { carrier: 'Blue Dart', trackingNumber: 'BD-2' } },
            { itemId: c._id, tracking: { carrier: 'Blue Dart', trackingNumber: 'BD-3' } },
          ],
        })
        .expect(200)
    ).body.data;
    expect(byId(res)[b._id].tracking.trackingNumber).toBe('BD-2');
    expect(byId(res)[c._id]).toMatchObject({ status: 'shipped', tracking: { trackingNumber: 'BD-3' } });
    expect(byId(res)[a._id].tracking.trackingNumber).toBe('DLV-ALL');
  });

  it('changes nothing when one of the picked items cannot ship', async () => {
    const order = await placeOrder();
    const [a, b] = order.items;
    await request(app).patch(`${API}/admin/orders/${order._id}/items/${b._id}`).set(A()).send({ status: 'cancelled' }).expect(200);
    const res = await request(app)
      .post(`${API}/admin/orders/${order._id}/ship`)
      .set(A())
      .send({ items: [a, b].map((i) => ({ itemId: i._id, tracking: { trackingNumber: 'X1' } })) })
      .expect(409);
    expect(res.body.error.code).toBe('INVALID_TRANSITION');
    const saved = await Order.findById(order._id).lean();
    expect(saved.items.find((i) => String(i._id) === a._id).status).toBe('confirmed');
  });
});

describe('delete an order', () => {
  it('removes the order and its invoices; customers no longer see it', async () => {
    const order = await placeOrder();
    await request(app)
      .post(`${API}/admin/orders/${order._id}/ship`)
      .set(A())
      .send({ items: order.items.map((i) => ({ itemId: i._id, tracking: { trackingNumber: 'DEL-1' } })) })
      .expect(200);
    expect(await Invoice.countDocuments({ order: order._id })).toBe(1);

    const res = (await request(app).delete(`${API}/admin/orders/${order._id}`).set(A()).expect(200)).body.data;
    expect(res).toMatchObject({ deleted: true, orderNumber: order.orderNumber });
    expect(await Order.exists({ _id: order._id })).toBeNull();
    expect(await Invoice.countDocuments({ order: order._id })).toBe(0);
    await request(app).get(`${API}/admin/orders/${order._id}`).set(A()).expect(404);
    await request(app).get(`${API}/user/orders/${order._id}`).set(U()).expect(404);
    await request(app).delete(`${API}/admin/orders/${order._id}`).set(A()).expect(404);
  });

  it('is limited to admins who can manage orders', async () => {
    const order = await placeOrder();
    const password = 'Staff!pass123';
    await request(app)
      .post(`${API}/admin/admins`)
      .set(A())
      .send({ name: 'Viewer', email: 'viewer@toolbox.test', password, role: 'admin', permissions: { orders: 'view' } })
      .expect(201);
    const viewer = (await request(app).post(`${API}/auth/admin/login`).send({ email: 'viewer@toolbox.test', password }).expect(200)).body
      .data.accessToken;
    await request(app).delete(`${API}/admin/orders/${order._id}`).set(bearer(viewer)).expect(403);
    expect(await Order.exists({ _id: order._id })).not.toBeNull();
  });
});
