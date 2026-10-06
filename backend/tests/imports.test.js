import { parse } from 'csv-parse/sync';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ProductImport, ProductImportItem } from '#modules/products/imports/import.model.js';
import { productImportService } from '#modules/products/imports/import.service.js';
import { Product } from '#modules/products/product.model.js';
import { downloadRemoteImage } from '#services/storage/remoteImage.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp, testImage, upload } from './helpers.js';

let app;
let vendor;
let other;
let admin;

const V = () => bearer(vendor.accessToken);
const BASE = `${API}/vendor/product-imports`;

const HEADER =
  'handle,sku,name,type,category,mrp,price,gst_rate,hsn_code,stock,publish,option1_name,option1_value,variant_price,variant_mrp,variant_stock,image_urls';
const csv = (...rows) => Buffer.from([HEADER, ...rows].join('\n'));

function uploadCsv(buffer, { mode = 'create', token = vendor.accessToken, name = 'products.csv' } = {}) {
  return request(app).post(BASE).set(bearer(token)).field('mode', mode).attach('file', buffer, { filename: name, contentType: 'text/csv' });
}

async function runImport(id) {
  await request(app).post(`${BASE}/${id}/start`).set(V()).expect(200);
  await productImportService.processQueued({ budgetMs: 20_000 });
  return (await request(app).get(`${BASE}/${id}`).set(V()).expect(200)).body.data;
}

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9500000001' });
  other = await approvedVendor(app, admin.accessToken, {
    phone: '9500000002',
    storeName: 'Other',
    gstin: '07AAACR5055K1Z3',
    pan: 'AAACR5055K',
  });
  await setModeration({ autoApproveProducts: true });
  const root = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Pumps' }).expect(201)).body
    .data;
  await request(app)
    .post(`${API}/admin/categories`)
    .set(bearer(admin.accessToken))
    .send({ name: 'Monoblock', parent: root._id })
    .expect(201);
  await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Gloves' }).expect(201);
});
afterAll(stopTestApp);

describe('template & reference files', () => {
  it('serves a template with every column and the vendor’s categories', async () => {
    const t = await request(app).get(`${BASE}/template.csv`).set(V()).expect(200);
    expect(t.headers['content-type']).toContain('text/csv');
    const rows = parse(t.text, { bom: true });
    expect(rows[0]).toEqual(expect.arrayContaining(['name', 'category', 'hsn_code', 'option1_name', 'variant_price', 'image_urls']));
    const cats = parse((await request(app).get(`${BASE}/categories.csv`).set(V()).expect(200)).text, { bom: true });
    expect(cats.map((r) => r[0])).toContain('Pumps > Monoblock');
  });
});

describe('validate then import', () => {
  let importId;

  it('checks every row and reports problems with sheet row numbers', async () => {
    const res = await uploadCsv(
      csv(
        ',PMP-1,Monoblock Pump 1HP,machinery,Pumps > Monoblock,"8,500",7850,18,8413,10,yes,,,,,,',
        ',,Garden Pump,machinery,monoblock,5000,4500,18,8413,5,no,,,,,,',
        'gloves,GLV,Nitrile Gloves,tool,Gloves,,,18,6116,,yes,Size,M,399,499,20,',
        'gloves,,,,,,,,,,,,L,429,499,0,',
        ',BAD-1,Broken Row,machinery,Nowhere,100,200,18,8413,1,no,,,,,,',
        ',BAD-2,Bad price,machinery,Pumps,abc,100,7,84,1,no,,,,,,',
      ),
    ).expect(201);
    importId = res.body.data._id;
    expect(res.body.data).toMatchObject({ status: 'validated', counts: { rows: 6, items: 5, valid: 3, invalid: 2 } });

    const problems = (await request(app).get(`${BASE}/${importId}/items?status=problems`).set(V()).expect(200)).body.data;
    expect(problems.map((p) => p.rows[0])).toEqual([6, 7]);
    expect(problems[0].issues).toContainEqual(
      expect.objectContaining({ row: 6, column: 'category', message: expect.stringContaining('Unknown category') }),
    );
    expect(problems[0].issues).toContainEqual(
      expect.objectContaining({ column: 'price', message: 'Selling price cannot be more than MRP' }),
    );
    const cols = problems[1].issues.map((i) => i.column);
    expect(cols).toEqual(expect.arrayContaining(['mrp', 'gst_rate', 'hsn_code']));

    const report = parse((await request(app).get(`${BASE}/${importId}/issues.csv`).set(V()).expect(200)).text, { bom: true });
    expect(report[0]).toEqual(['row', 'column', 'product', 'sku', 'status', 'problem']);
    expect(report.some((r) => r[0] === '6' && r[1] === 'category')).toBe(true);
    expect(await Product.countDocuments({ vendor: vendor.account._id })).toBe(0);
  });

  it('imports the valid products (including variants) in the background', async () => {
    const done = await runImport(importId);
    expect(done).toMatchObject({ status: 'completed', progress: 100, counts: { created: 3, failed: 0 } });

    const pump = await Product.findOne({ sku: 'PMP-1' }).lean();
    expect(pump).toMatchObject({
      status: 'active',
      pricing: { mrp: 850_000, price: 785_000, gstRate: 18 },
      hsnCode: '8413',
      inventory: { stock: 10 },
    });
    const garden = await Product.findOne({ name: 'Garden Pump' }).lean();
    expect(garden.sku).toMatch(/^GAR-PUM-/);
    expect(garden.status).toBe('draft');
    const gloves = await Product.findOne({ sku: 'GLV' }).lean();
    expect(gloves.variantOptions).toEqual([{ name: 'Size', values: ['M', 'L'] }]);
    expect(gloves.variants.map((v) => [v.options[0], v.price, v.stock])).toEqual([
      ['M', 39_900, 20],
      ['L', 42_900, 0],
    ]);
    // Starting twice does nothing.
    await request(app).post(`${BASE}/${importId}/start`).set(V()).expect(409);
  });

  it('create mode refuses existing SKUs; update mode changes them; export round-trips', async () => {
    const dup = (await uploadCsv(csv(',PMP-1,Monoblock Pump 1HP,machinery,Monoblock,8500,7000,18,8413,10,yes,,,,,,')).expect(201)).body
      .data;
    expect(dup.counts).toMatchObject({ valid: 0, invalid: 1 });

    const exported = (await request(app).get(`${BASE}/export.csv`).set(V()).expect(200)).text;
    const rows = parse(exported, { bom: true, columns: true });
    const pumpRow = rows.find((r) => r.sku === 'PMP-1');
    expect(pumpRow).toMatchObject({ price: '7850', category: 'Pumps > Monoblock', publish: 'yes' });
    expect(rows.filter((r) => r.handle && r.handle === rows.find((x) => x.sku === 'GLV').handle)).toHaveLength(2);

    // Edit the price in the exported sheet and re-upload as an update.
    const edited = exported.replace(/(PMP-1,Monoblock Pump 1HP,[^\n]*?),8500,7850,/, '$1,8500,7499,');
    const upd = (await uploadCsv(Buffer.from(edited), { mode: 'upsert' }).expect(201)).body.data;
    expect(upd.counts).toMatchObject({ invalid: 0 });
    const result = await runImport(upd._id);
    expect(result.counts).toMatchObject({ updated: upd.counts.valid, created: 0, failed: 0 });
    expect((await Product.findOne({ sku: 'PMP-1' }).lean()).pricing.price).toBe(749_900);
    expect(await Product.countDocuments({ vendor: vendor.account._id })).toBe(3);
  });

  it('flags duplicate SKUs in one file and rejects files without required columns or that are not CSV', async () => {
    const d = (
      await uploadCsv(csv(',X-1,A,tool,Gloves,100,90,18,6116,1,no,,,,,,', ',X-1,B,tool,Gloves,100,90,18,6116,1,no,,,,,,')).expect(201)
    ).body.data;
    expect(d.counts.invalid).toBe(2);

    const bad = (await uploadCsv(Buffer.from('name,price\nThing,10\n')).expect(201)).body.data;
    expect(bad.fileIssues[0].message).toContain('Missing required columns');
    await request(app).post(`${BASE}/${bad._id}/start`).set(V()).expect(409);

    const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]);
    expect((await uploadCsv(zip).expect(400)).body.error.code).toBe('UNSUPPORTED_FILE');
    await uploadCsv(Buffer.from('a,b'), { name: 'products.xlsx' }).expect(400);
  });
});

describe('images', () => {
  it('reuses images the vendor already has and skips unreachable or internal links without losing the product', async () => {
    const media = (await upload(app, vendor.accessToken, 'products', [await testImage({ width: 600, height: 600 })]).expect(201)).body
      .data[0];
    const res = (
      await uploadCsv(
        csv(
          `,IMG-1,Imaged Pump,machinery,Pumps,1000,900,18,8413,3,no,,,,,,${media.url} | http://127.0.0.1:9/x.png | http://169.254.169.254/latest`,
        ),
      ).expect(201)
    ).body.data;
    await runImport(res._id);
    const p = await Product.findOne({ sku: 'IMG-1' }).lean();
    expect(p.images.map((i) => String(i.media))).toEqual([media._id]);
    const [item] = (await request(app).get(`${BASE}/${res._id}/items`).set(V()).expect(200)).body.data;
    expect(item.status).toBe('created');
    expect(item.issues.filter((i) => i.message.startsWith('Image skipped'))).toHaveLength(2);
  });

  it('blocks private, loopback and metadata addresses before connecting', async () => {
    for (const url of [
      'http://127.0.0.1/a.png',
      'http://[::1]/a.png',
      'http://169.254.169.254/',
      'http://10.0.0.5/a',
      'http://localhost/a.png',
      'file:///etc/passwd',
    ]) {
      await expect(downloadRemoteImage(url)).rejects.toThrow(/not allowed|Only http|Could not download/);
    }
  });
});

describe('resilience & access', () => {
  it('validates a full 5000-row file quickly and rejects larger ones', async () => {
    const rows = Array.from({ length: 5000 }, (_, i) => `,BIG-${i},Bulk Pump ${i},machinery,Pumps,1000,900,18,8413,3,no,,,,,,`);
    const started = Date.now();
    const res = (await uploadCsv(csv(...rows)).expect(201)).body.data;
    expect(res.counts).toMatchObject({ rows: 5000, valid: 5000, invalid: 0 });
    expect(Date.now() - started).toBeLessThan(20_000);
    await request(app).post(`${BASE}/${res._id}/cancel`).set(V()).expect(200);

    const tooMany = (await uploadCsv(csv(...rows, rows[0].replace('BIG-0', 'BIG-X'))).expect(201)).body.data;
    expect(tooMany.fileIssues[0].message).toContain('Up to 5000 rows');
  }, 60_000);

  it('resumes after a crash without creating a product twice', async () => {
    const res = (await uploadCsv(csv(',RES-1,Resume Pump,machinery,Pumps,1000,900,18,8413,3,no,,,,,,')).expect(201)).body.data;
    await request(app).post(`${BASE}/${res._id}/start`).set(V()).expect(200);
    // Simulate a worker that created the product, then died before recording it.
    const item = await ProductImportItem.findOne({ import: res._id });
    await Product.create({
      vendor: vendor.account._id,
      vendorApproved: true,
      category: (await Product.findOne({ sku: 'PMP-1' }).lean()).category,
      type: 'machinery',
      name: 'Resume Pump',
      slug: 'resume-pump',
      sku: 'RES-1',
      pricing: { mrp: 100_000, price: 90_000, gstRate: 18 },
      hsnCode: '8413',
    });
    await ProductImportItem.updateOne({ _id: item._id }, { status: 'processing', attempts: 1 });
    await ProductImport.updateOne(
      { _id: res._id },
      { status: 'processing', lease: { owner: 'dead-worker', until: new Date(Date.now() - 1000) } },
    );

    await productImportService.processQueued({ budgetMs: 5_000 });
    expect((await ProductImport.findById(res._id).lean()).status).toBe('completed');
    expect((await ProductImportItem.findById(item._id).lean()).status).toBe('created');
    expect(await Product.countDocuments({ sku: 'RES-1' })).toBe(1);
  });

  it('keeps imports private to their vendor and lets an unstarted import be cancelled', async () => {
    const res = (await uploadCsv(csv(',PRV-1,Private,machinery,Pumps,1000,900,18,8413,3,no,,,,,,')).expect(201)).body.data;
    await request(app).get(`${BASE}/${res._id}`).set(bearer(other.accessToken)).expect(404);
    await request(app).post(`${BASE}/${res._id}/start`).set(bearer(other.accessToken)).expect(404);
    await request(app).get(`${BASE}/${res._id}/issues.csv`).set(bearer(other.accessToken)).expect(404);
    const cancelled = (await request(app).post(`${BASE}/${res._id}/cancel`).set(V()).expect(200)).body.data;
    expect(cancelled.status).toBe('cancelled');
    await request(app).post(`${BASE}/${res._id}/start`).set(V()).expect(409);
    await request(app).get(BASE).set(bearer(admin.accessToken)).expect(401);
  });
});
