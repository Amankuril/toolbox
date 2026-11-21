import { writeFile } from 'node:fs/promises';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainText } from '#modules/products/catalog.pdf.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp, testImage, upload } from './helpers.js';

let app;
let admin;
let category;

const A = () => bearer(admin.accessToken);
const pdf = (query = {}) =>
  request(app)
    .get(`${API}/admin/products/catalog.pdf`)
    .query(query)
    .set(A())
    .buffer(true)
    .parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000001' });
  await setModeration({ autoApproveProducts: true });
  category = (await request(app).post(`${API}/admin/categories`).set(A()).send({ name: 'Power tools' }).expect(201)).body.data;
  const other = (await request(app).post(`${API}/admin/categories`).set(A()).send({ name: 'Pumps' }).expect(201)).body.data;
  const [img] = (await upload(app, vendor.accessToken, 'products', [await testImage({ width: 800, height: 600, color: '#2b6cb0' })]).expect(201)).body.data;

  const V = bearer(vendor.accessToken);
  const base = { type: 'tool', hsnCode: '8467', inventory: { stock: 12, moq: 1 }, publish: true };
  await request(app)
    .post(`${API}/vendor/products`)
    .set(V)
    .send({
      ...base,
      name: 'Bosch GSB 500W Impact Drill',
      category: category._id,
      brand: 'Bosch',
      modelNumber: 'GSB 501',
      images: [{ media: img._id }],
      shortDescription: 'Compact 500 W impact drill for masonry, wood and steel, with a keyed 13 mm chuck and reverse.',
      pricing: { mrp: 450_000, price: 329_900, gstRate: 18 },
      specifications: [
        { label: 'Power', value: '500 W' },
        { label: 'Chuck', value: '13 mm' },
        { label: 'Speed', value: '0–3000 rpm' },
      ],
      warranty: { months: 6 },
    })
    .expect(201);
  await request(app)
    .post(`${API}/vendor/products`)
    .set(V)
    .send({
      ...base,
      name: 'Safety Gloves',
      category: category._id,
      description: '<p>Cut-resistant <strong>level 5</strong> gloves &amp; liners.</p>',
      pricing: { mrp: 40_000, price: 30_000, gstRate: 12 },
      variantOptions: [{ name: 'Size', values: ['M', 'L', 'XL'] }],
      variants: [
        { options: ['M'], price: 30_000, mrp: 40_000, stock: 4 },
        { options: ['L'], price: 32_000, mrp: 40_000, stock: 0 },
        { options: ['XL'], price: 35_000, mrp: 40_000, stock: 2 },
      ],
    })
    .expect(201);
  await request(app)
    .post(`${API}/vendor/products`)
    .set(V)
    .send({ ...base, type: 'machinery', name: 'Monoblock Pump 1HP', category: other._id, pricing: { mrp: 800_000, price: 800_000, gstRate: 18 } })
    .expect(201);
});
afterAll(stopTestApp);

describe('product catalogue PDF', () => {
  it('downloads every product, or only those matching the filters', async () => {
    const all = await pdf().expect(200);
    expect(all.headers['content-type']).toBe('application/pdf');
    expect(all.headers['content-disposition']).toMatch(/attachment; filename="Product-catalogue-\d{4}-\d{2}-\d{2}\.pdf"/);
    expect(all.body.subarray(0, 5).toString()).toBe('%PDF-');
    // Kept for a visual check when debugging layout.
    if (process.env.CATALOG_PDF_OUT) await writeFile(process.env.CATALOG_PDF_OUT, all.body);

    const filtered = await pdf({ category: category._id, q: 'drill' }).expect(200);
    expect(filtered.body.subarray(0, 5).toString()).toBe('%PDF-');
    // One product with a photo, versus three: the filtered file is the smaller one.
    expect(filtered.body.length).toBeLessThan(all.body.length);

    const none = await pdf({ q: 'nothing-matches-this' }).expect(200);
    expect(none.body.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('is for admins only', async () => {
    await request(app).get(`${API}/admin/products/catalog.pdf`).expect(401);
  });

  it('turns rich-text descriptions into plain text', () => {
    expect(plainText('<p>Cut-resistant <strong>level 5</strong> gloves &amp; liners.</p><p>Wash&nbsp;cold</p>')).toBe(
      'Cut-resistant level 5 gloves & liners. Wash cold',
    );
  });
});
