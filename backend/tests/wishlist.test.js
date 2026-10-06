import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let customer;
let drill;
let grinder;
const U = () => bearer(customer.accessToken);

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Drills' }).expect(201)).body
    .data;
  const make = async (name) =>
    (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(bearer(vendor.accessToken))
        .send({
          type: 'tool',
          name,
          category: cat._id,
          pricing: { mrp: 500_000, price: 450_000, gstRate: 18 },
          hsnCode: '8467',
          inventory: { stock: 10, moq: 1 },
          publish: true,
        })
        .expect(201)
    ).body.data;
  drill = await make('Cordless drill 18V');
  grinder = await make('Angle grinder 4 inch');
  customer = await otpSignIn(app, { phone: '9600000099', audience: 'user', register: { name: 'Meera' } });
});
afterAll(stopTestApp);

describe('wishlist', () => {
  it('needs a signed-in customer', async () => {
    await request(app).get(`${API}/user/wishlist`).expect(401);
  });

  it('adds idempotently, lists newest first and removes', async () => {
    await request(app).put(`${API}/user/wishlist/${drill._id}`).set(U()).expect(200);
    await request(app).put(`${API}/user/wishlist/${drill._id}`).set(U()).expect(200);
    const ids = (await request(app).put(`${API}/user/wishlist/${grinder._id}`).set(U()).expect(200)).body.data;
    expect(ids).toEqual([grinder._id, drill._id]);

    const list = (await request(app).get(`${API}/user/wishlist`).set(U()).expect(200)).body.data;
    expect(list.map((r) => r.product.name)).toEqual(['Angle grinder 4 inch', 'Cordless drill 18V']);
    expect(list[0]).toMatchObject({ available: true, product: { price: 450_000 } });

    expect((await request(app).delete(`${API}/user/wishlist/${grinder._id}`).set(U()).expect(200)).body.data).toEqual([drill._id]);
  });

  it('flags products taken down after saving, and refuses unknown ones', async () => {
    await Product.updateOne({ _id: drill._id }, { status: 'inactive' });
    const list = (await request(app).get(`${API}/user/wishlist`).set(U()).expect(200)).body.data;
    expect(list[0]).toMatchObject({ available: false });
    // A fresh id is guaranteed unknown (tweaking a real id can land on the other product's id).
    await request(app).put(`${API}/user/wishlist/${new mongoose.Types.ObjectId()}`).set(U()).expect(404);
    await Product.updateOne({ _id: drill._id }, { status: 'active' });
  });

  it('merges a guest list after sign-in, skipping duplicates', async () => {
    const ids = (
      await request(app)
        .post(`${API}/user/wishlist/merge`)
        .set(U())
        .send({ productIds: [drill._id, grinder._id] })
        .expect(200)
    ).body.data;
    expect(ids.sort()).toEqual([drill._id, grinder._id].sort());
    expect((await request(app).get(`${API}/user/wishlist/ids`).set(U()).expect(200)).body.data).toHaveLength(2);
  });
});
