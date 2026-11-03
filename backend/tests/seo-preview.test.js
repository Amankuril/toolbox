import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;
let cat;
let existing;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000101' });
  await setModeration({ autoApproveProducts: true });
  cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Water pumps' }).expect(201)).body.data;
  existing = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'machinery',
        name: 'Kisankraft 2 inch petrol water pump',
        category: cat._id,
        pricing: { mrp: 3_000_000, price: 2_290_000, gstRate: 18 },
        hsnCode: '8413',
        inventory: { stock: 2, moq: 1 },
        warranty: { months: 6 },
        publish: true,
      })
      .expect(201)
  ).body.data;
});
afterAll(() => stopTestApp());

const preview = (token, audience, body) => request(app).post(`${API}/${audience}/seo-audit/preview`).set(bearer(token)).send(body);

describe('SEO checks while writing a product', () => {
  it('scores a thin draft and suggests the fixes, including keywords from the category', async () => {
    const res = await preview(vendor.accessToken, 'vendor', { name: 'PUMP', category: cat._id, pricing: { price: 500_000 } }).expect(200);
    const { score, issues, suggestion } = res.body.data;
    const keys = issues.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['title_short', 'meta_missing', 'no_keywords', 'description_thin', 'few_images', 'no_brand']));
    expect(issues.find((i) => i.key === 'no_keywords')).toMatchObject({ label: 'No search keywords', fix: true });
    expect(score).toBeLessThan(50);
    expect(suggestion.searchKeywords).toEqual(expect.arrayContaining(['water pumps', 'buy water pumps online']));
    expect(suggestion.seoTitle.length).toBeGreaterThanOrEqual(4);
  });

  it('flags a name another product already uses, but not the product being edited', async () => {
    const dup = await preview(vendor.accessToken, 'vendor', { name: 'kisankraft 2 inch PETROL water pump' }).expect(200);
    expect(dup.body.data.issues.map((i) => i.key)).toContain('duplicate_title');
    const self = await preview(vendor.accessToken, 'vendor', { name: existing.name, productId: existing._id }).expect(200);
    expect(self.body.data.issues.map((i) => i.key)).not.toContain('duplicate_title');
  });

  it('is available to admins editing any product and to the house store', async () => {
    await preview(admin.accessToken, 'admin', { name: 'Anything' }).expect(200);
    await preview(admin.accessToken, 'admin/store', { name: 'Anything' }).expect(200);
  });
});
