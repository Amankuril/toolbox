import mongoose from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let drill;
let grinder;
let saw;

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000011' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Power tools' }).expect(201))
    .body.data;
  const make = async (name, specifications) =>
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
          specifications,
          warranty: { months: 12 },
          publish: true,
        })
        .expect(201)
    ).body.data;
  drill = await make('Cordless drill 18V', [
    { label: 'Voltage', value: '18 V' },
    { label: 'Chuck', value: '13 mm' },
    { label: 'Torque', value: '45 Nm' },
    { label: 'Weight', value: '1.6 kg' },
  ]);
  grinder = await make('Angle grinder 4 inch', [{ label: 'Power', value: '850 W' }]);
  saw = await make('Circular saw', [{ label: 'Blade', value: '185 mm' }]);
});
afterAll(stopTestApp);

describe('product comparison', () => {
  it('returns full specs, seller and category in the order asked', async () => {
    const rows = (
      await request(app)
        .get(`${API}/public/products/compare`)
        .query({ ids: `${grinder._id},${drill._id}` })
        .expect(200)
    ).body.data;
    expect(rows.map((r) => r.name)).toEqual(['Angle grinder 4 inch', 'Cordless drill 18V']);
    expect(rows[1].specifications).toHaveLength(4);
    expect(rows[1]).toMatchObject({
      price: 450_000,
      gstRate: 18,
      warranty: { months: 12 },
      category: { name: 'Power tools' },
      vendor: { store: { name: 'Acme Tools' } },
    });
    expect(rows[1].description).toBeUndefined();
  });

  it('drops products that are no longer listed, and dedupes ids', async () => {
    await Product.updateOne({ _id: saw._id }, { status: 'inactive' });
    const ids = [drill._id, drill._id, saw._id, new mongoose.Types.ObjectId()].join(',');
    const rows = (await request(app).get(`${API}/public/products/compare`).query({ ids }).expect(200)).body.data;
    expect(rows.map((r) => r._id)).toEqual([drill._id]);
  });

  it('caps the comparison at four products', async () => {
    const ids = Array.from({ length: 5 }, () => new mongoose.Types.ObjectId()).join(',');
    await request(app).get(`${API}/public/products/compare`).query({ ids }).expect(422);
    await request(app).get(`${API}/public/products/compare`).expect(422);
  });
});
