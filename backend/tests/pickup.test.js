import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let vendor;
let customer;
let product;
let addressId;

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9400000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Pumps' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({ type: 'machinery', name: 'Water Pump', category: cat._id, pricing: { mrp: 500_000, price: 400_000, gstRate: 18 }, inventory: { stock: 5 }, hsnCode: '8413', publish: true })
      .expect(201)
  ).body.data;
  customer = await otpSignIn(app, { phone: '9400000099', audience: 'user', register: { name: 'Buyer' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(bearer(customer.accessToken))
      .send({ name: 'Buyer', phone: '9400000099', line1: 'Main Road', city: 'Muzaffarnagar', state: 'Uttar Pradesh', pincode: '251001' })
      .expect(201)
  ).body.data[0]._id;
  await settingsService.update('shipping', { flatFee: 15_000 }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('self pickup', () => {
  let points;

  it('sellers add warehouses; buyers see them nearest first', async () => {
    const saved = (
      await request(app)
        .put(`${API}/vendor/pickup`)
        .set(bearer(vendor.accessToken))
        .send({
          enabled: true,
          includeMainAddress: true,
          hours: '10am–7pm',
          warehouses: [{ name: 'Budhana godown', line1: 'Mandi Samiti', city: 'Budhana', state: 'Uttar Pradesh', pincode: '251309' }],
        })
        .expect(200)
    ).body.data;
    expect(saved.points.map((p) => p.name)).toEqual(['Acme Tools', 'Budhana godown']);

    const res = (await request(app).get(`${API}/public/pickup-points?vendors=${vendor.account._id}&pincode=251001`).expect(200)).body.data;
    points = res[vendor.account._id];
    // The Pune business address shares no pincode prefix with 251001; the Budhana godown shares "251".
    expect(points[0]).toMatchObject({ name: 'Budhana godown', nearby: true });
  });

  it('a pickup order has no delivery fee, skips part payment and can be marked collected', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(bearer(customer.accessToken)).send({ quantity: 1 }).expect(200);
    const pickups = [{ vendor: vendor.account._id, point: points[0]._id }];
    await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(bearer(customer.accessToken))
      .send({ addressId, paymentMethod: 'partial', pickups })
      .expect(422);
    const { order } = (
      await request(app).post(`${API}/user/orders/checkout`).set(bearer(customer.accessToken)).send({ addressId, paymentMethod: 'cod', pickups }).expect(201)
    ).body.data;
    expect(order.amounts).toMatchObject({ shipping: 0, total: 400_000 });
    expect(order.pickups[0]).toMatchObject({ name: 'Budhana godown', city: 'Budhana' });

    const item = order.items[0];
    const V = bearer(vendor.accessToken);
    await request(app).patch(`${API}/vendor/orders/${order._id}/items/${item._id}`).set(V).send({ status: 'confirmed' }).expect(200);
    const done = (await request(app).patch(`${API}/vendor/orders/${order._id}/items/${item._id}`).set(V).send({ status: 'delivered' }).expect(200)).body.data;
    expect(done).toMatchObject({ status: 'completed', payment: { status: 'paid' } });
  });

  it('a stale pickup choice is refused', async () => {
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(bearer(customer.accessToken)).send({ quantity: 1 }).expect(200);
    await request(app)
      .post(`${API}/user/orders/checkout`)
      .set(bearer(customer.accessToken))
      .send({ addressId, paymentMethod: 'cod', pickups: [{ vendor: vendor.account._id, point: '000000000000000000000000' }] })
      .expect(422);
  });
});
