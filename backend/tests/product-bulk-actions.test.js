import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;
let other;
let cat;

const make = async (token, name, publish = true) =>
  (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(token))
      .send({
        type: 'tool',
        name,
        category: cat._id,
        pricing: { mrp: 100_000, price: 90_000, gstRate: 18 },
        hsnCode: '8467',
        inventory: { stock: 3, moq: 1 },
        warranty: { months: 6 },
        publish,
      })
      .expect(201)
  ).body.data;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000091' });
  other = await approvedVendor(app, admin.accessToken, { phone: '9600000092', storeName: 'Other Tools', gstin: '29AAGCB1234C1Z5', pan: 'AAGCB1234C' });
  cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Drills' }).expect(201)).body.data;
});
afterAll(() => stopTestApp());

describe('bulk actions on ticked products', () => {
  it('sellers hide, show and delete only their own products', async () => {
    await setModeration({ autoApproveProducts: true });
    const a = await make(vendor.accessToken, 'Drill A');
    const b = await make(vendor.accessToken, 'Drill B');
    const theirs = await make(other.accessToken, 'Drill C');
    const act = (action, ids) => request(app).post(`${API}/vendor/products/bulk-action`).set(bearer(vendor.accessToken)).send({ action, ids });

    expect((await act('hide', [a._id, b._id, theirs._id]).expect(200)).body.data).toEqual({ updated: 2, skipped: 1 });
    expect((await Product.findById(theirs._id)).status).toBe('active');
    expect((await act('show', [a._id]).expect(200)).body.data.updated).toBe(1);
    expect((await act('delete', [a._id, b._id]).expect(200)).body.data.updated).toBe(2);
    const list = (await request(app).get(`${API}/vendor/products`).set(bearer(vendor.accessToken)).expect(200)).body.data;
    expect(list.map((p) => p._id)).not.toContain(a._id);
    expect((await Product.findById(a._id)).status).toBe('archived');
  });

  it('sellers cannot feature or approve', async () => {
    const res = await request(app).post(`${API}/vendor/products/bulk-action`).set(bearer(vendor.accessToken)).send({ action: 'feature', ids: [cat._id] });
    expect(res.status).toBe(422);
  });

  it('admins approve, feature and delete across vendors, skipping rows the action does not fit', async () => {
    await setModeration({ autoApproveProducts: false });
    const p1 = await make(vendor.accessToken, 'Pending 1');
    const p2 = await make(other.accessToken, 'Pending 2');
    const draft = await make(vendor.accessToken, 'Draft', false);
    const act = (action, ids) => request(app).post(`${API}/admin/products/bulk-action`).set(bearer(admin.accessToken)).send({ action, ids });

    expect((await act('approve', [p1._id, p2._id, draft._id]).expect(200)).body.data).toEqual({ updated: 2, skipped: 1 });
    expect((await Product.findById(p2._id)).status).toBe('active');
    expect((await act('feature', [p1._id, p2._id, draft._id]).expect(200)).body.data.updated).toBe(2);
    expect((await act('unfeature', [p1._id]).expect(200)).body.data.updated).toBe(1);
    expect((await act('delete', [p2._id, draft._id]).expect(200)).body.data.updated).toBe(2);
    expect((await Product.findById(p2._id)).isFeatured).toBe(false);
  });
});
