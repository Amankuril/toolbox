import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;
let other;
let product;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9700000001' });
  other = await approvedVendor(app, admin.accessToken, { phone: '9700000002', storeName: 'Other', gstin: '29AAPFU0939F1ZT' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Tillers' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({ type: 'machinery', name: 'Power Tiller', category: cat._id, pricing: { mrp: 9_000_000, price: 8_500_000, gstRate: 12 }, inventory: { stock: 0 }, hsnCode: '8432', publish: true })
      .expect(201)
  ).body.data;
});
afterAll(stopTestApp);

describe('out of stock enquiries', () => {
  it('a guest asks; asking again updates the same enquiry; only the seller and admins see it', async () => {
    const send = (body) => request(app).post(`${API}/public/products/${product._id}/enquiries`).send(body);
    const first = (await send({ name: 'Kisan', phone: '9711111111', quantity: 2 }).expect(201)).body.data;
    const again = (await send({ name: 'Kisan', phone: '+91 97111 11111', quantity: 3, message: 'Need before sowing' }).expect(201)).body.data;
    expect(again._id).toBe(first._id);

    const mine = (await request(app).get(`${API}/vendor/enquiries`).set(bearer(vendor.accessToken)).expect(200)).body;
    expect(mine.data[0]).toMatchObject({ name: 'Kisan', phone: '+919711111111', quantity: 3, status: 'open', product: { name: 'Power Tiller', inStock: false } });
    expect((await request(app).get(`${API}/vendor/enquiries`).set(bearer(other.accessToken)).expect(200)).body.data).toHaveLength(0);
    await request(app).patch(`${API}/vendor/enquiries/${first._id}`).set(bearer(other.accessToken)).send({ status: 'closed' }).expect(404);

    const all = (await request(app).get(`${API}/admin/enquiries`).set(bearer(admin.accessToken)).expect(200)).body.data;
    expect(all[0].vendor).toMatchObject({ name: 'Acme Tools' });
    const done = (await request(app).patch(`${API}/admin/enquiries/${first._id}`).set(bearer(admin.accessToken)).send({ status: 'contacted' }).expect(200)).body.data;
    expect(done.status).toBe('contacted');
  });
});
