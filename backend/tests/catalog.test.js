import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { env } from '#config/env.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import {
  API,
  approvedVendor,
  bearer,
  createAdmin,
  otpSignIn,
  setModeration,
  startTestApp,
  stopTestApp,
  testImage,
  upload,
} from './helpers.js';

let app;
let admin;
let vendor;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9100000001' });
});
afterAll(stopTestApp);

describe('vendor onboarding', () => {
  it('walks through the wizard, locks details after submission and encrypts the bank account', async () => {
    const s = await otpSignIn(app, {
      phone: '9100000002',
      audience: 'vendor',
      register: { contactName: 'Meera', email: 'meera@shop.test', storeName: 'Meera Machines' },
    });
    expect(s.account).toMatchObject({ status: 'onboarding', store: { name: 'Meera Machines', slug: 'meera-machines' } });
    const auth = bearer(s.accessToken);

    const early = await request(app).post(`${API}/vendor/onboarding/submit`).set(auth).expect(422);
    expect(early.body.error.code).toBe('ONBOARDING_INCOMPLETE');

    const mismatch = await request(app)
      .put(`${API}/vendor/onboarding/business`)
      .set(auth)
      .send({ legalName: 'Meera Machines LLP', type: 'llp', gstin: '29AAGCB1234C1Z5', pan: 'ZZZZZ9999Z' })
      .expect(422);
    expect(mismatch.body.error.details[0].path).toBe('pan');

    await request(app)
      .put(`${API}/vendor/onboarding/business`)
      .set(auth)
      .send({ legalName: 'Meera Machines LLP', type: 'llp', gstin: '29AAGCB1234C1Z5', pan: 'AAGCB1234C' })
      .expect(200);
    const bank = await request(app)
      .put(`${API}/vendor/onboarding/bank`)
      .set(auth)
      .send({
        accountHolderName: 'Meera',
        accountNumber: '998877665544',
        confirmAccountNumber: '998877665544',
        ifsc: 'ICIC0000123',
        bankName: 'ICICI',
      })
      .expect(200);
    expect(bank.body.data.bank.accountNumberMasked).toBe('XXXXXX5544');
    expect(JSON.stringify(bank.body)).not.toContain('998877665544');

    const stored = await Vendor.findById(s.account._id).select('+bank.accountNumberEnc').lean();
    expect(stored.bank.accountNumberEnc).toMatch(/^v1\./);

    const reveal = await request(app).get(`${API}/admin/vendors/${s.account._id}/bank-account`).set(bearer(admin.accessToken)).expect(200);
    expect(reveal.body.data.accountNumber).toBe('998877665544');

    // Vendors can't list products before approval.
    const blocked = await request(app).post(`${API}/vendor/products`).set(auth).send({}).expect(403);
    expect(blocked.body.error.code).toBe('VENDOR_NOT_APPROVED');
  });

  it('rejects a GSTIN already used by another seller', async () => {
    const s = await otpSignIn(app, {
      phone: '9100000003',
      audience: 'vendor',
      register: { contactName: 'Dup', email: 'dup@shop.test', storeName: 'Dup' },
    });
    const res = await request(app)
      .put(`${API}/vendor/onboarding/business`)
      .set(bearer(s.accessToken))
      .send({ legalName: 'Dup', type: 'other', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F' })
      .expect(409);
    expect(res.body.error.code).toBe('DUPLICATE_GSTIN');
  });
});

describe('media pipeline', () => {
  it('compresses to webp, bounds dimensions and stores locally when Cloudinary is off', async () => {
    const res = await upload(app, vendor.accessToken, 'products', [await testImage({ width: 3000, height: 1500 })]).expect(201);
    const media = res.body.data[0];
    expect(media).toMatchObject({ provider: 'local', folder: 'products', width: 1600, height: 800 });
    expect(media.url).toMatch(/^\/uploads\/products\/\d{4}\/\d{2}\/[0-9a-f-]+\.webp$/);

    const onDisk = path.join(env.LOCAL_UPLOAD_DIR, media.url.replace('/uploads/', ''));
    const meta = await sharp(await fs.readFile(onDisk)).metadata();
    expect(meta.format).toBe('webp');

    await request(app)
      .get(media.url)
      .expect(200)
      .expect('Content-Type', /image\/webp/);
  });

  it('rejects non-images even when they claim to be images', async () => {
    const res = await request(app)
      .post(`${API}/vendor/media?folder=products`)
      .set(bearer(vendor.accessToken))
      .attach('files', Buffer.from('<?php echo "hi"; ?>'), { filename: 'evil.png', contentType: 'image/png' })
      .expect(400);
    expect(res.body.error.code).toBe('UNSUPPORTED_FILE');
  });

  it('refuses folders outside the audience allowlist', async () => {
    await upload(app, vendor.accessToken, 'branding', [await testImage({ width: 100, height: 100 })]).expect(403);
  });

  it('refuses enabling Cloudinary when it is not configured', async () => {
    const res = await request(app)
      .put(`${API}/admin/settings/storage`)
      .set(bearer(admin.accessToken))
      .send({ cloudinaryEnabled: true })
      .expect(422);
    expect(res.body.error.code).toBe('INTEGRATION_NOT_CONFIGURED');
  });
});

describe('catalogue', () => {
  let root;
  let drills;
  let machine;

  it('admin builds the tree; vendor proposals stay pending until approved', async () => {
    const a = bearer(admin.accessToken);
    root = (await request(app).post(`${API}/admin/categories`).set(a).send({ name: 'Power Tools' }).expect(201)).body.data;
    expect(root).toMatchObject({ slug: 'power-tools', level: 0, status: 'active' });

    await request(app).post(`${API}/admin/categories`).set(a).send({ name: 'power tools' }).expect(409);

    const proposal = await request(app)
      .post(`${API}/vendor/categories`)
      .set(bearer(vendor.accessToken))
      .send({ name: 'Drills', parent: root._id })
      .expect(201);
    drills = proposal.body.data;
    expect(drills).toMatchObject({ status: 'pending', level: 1 });

    let tree = (await request(app).get(`${API}/public/categories/tree`).expect(200)).body.data;
    expect(tree.find((c) => c.slug === 'power-tools').children).toHaveLength(0);

    await request(app).post(`${API}/admin/categories/${drills._id}/review`).set(a).send({ action: 'approve' }).expect(200);
    tree = (await request(app).get(`${API}/public/categories/tree`).expect(200)).body.data;
    expect(tree.find((c) => c.slug === 'power-tools').children.map((c) => c.slug)).toEqual(['drills']);

    // Approved categories are no longer vendor-editable.
    await request(app)
      .patch(`${API}/vendor/categories/${drills._id}`)
      .set(bearer(vendor.accessToken))
      .send({ name: 'Drill Machines' })
      .expect(403);

    const leaf = await request(app).post(`${API}/admin/categories`).set(a).send({ name: 'Cordless', parent: drills._id }).expect(201);
    const tooDeep = await request(app)
      .post(`${API}/admin/categories`)
      .set(a)
      .send({ name: 'Too deep', parent: leaf.body.data._id })
      .expect(422);
    expect(tooDeep.body.error.code).toBe('MAX_DEPTH');
  });

  it('vendor lists machinery and a compatible spare part; admin approves; storefront shows them', async () => {
    const v = bearer(vendor.accessToken);
    const img = (await upload(app, vendor.accessToken, 'products', [await testImage({ width: 1200, height: 1200 })]).expect(201)).body
      .data[0];

    const created = await request(app)
      .post(`${API}/vendor/products`)
      .set(v)
      .send({
        type: 'machinery',
        name: 'Bosch GSB 500W Impact Drill',
        category: drills._id,
        sku: 'GSB-500',
        brand: 'Bosch',
        images: [{ media: img._id, alt: 'Front view' }],
        pricing: { mrp: 450_000, price: 389_900, gstRate: 18 },
        inventory: { stock: 12, moq: 1, unit: 'piece' },
        specifications: [{ label: 'Power', value: '500 W' }],
        publish: true,
      })
      .expect(201);
    machine = created.body.data;
    expect(machine).toMatchObject({ status: 'pending', slug: 'bosch-gsb-500w-impact-drill', pricing: { discountPercent: 13 } });
    expect(machine.images[0].url).toBe(img.url);

    await request(app)
      .post(`${API}/vendor/products`)
      .set(v)
      .send({
        type: 'tool',
        name: 'Dupe',
        category: drills._id,
        sku: 'GSB-500',
        pricing: { mrp: 100, price: 100, gstRate: 18 },
        inventory: { stock: 1 },
      })
      .expect(409);

    const pricey = await request(app)
      .post(`${API}/vendor/products`)
      .set(v)
      .send({
        type: 'tool',
        name: 'Bad price',
        category: drills._id,
        pricing: { mrp: 100, price: 200, gstRate: 18 },
        inventory: { stock: 1 },
      })
      .expect(422);
    expect(pricey.body.error.details[0].path).toBe('pricing.price');

    let list = (await request(app).get(`${API}/public/products?category=power-tools`).expect(200)).body;
    expect(list.data).toHaveLength(0);

    await request(app)
      .post(`${API}/admin/products/${machine._id}/review`)
      .set(bearer(admin.accessToken))
      .send({ action: 'approve' })
      .expect(200);

    const part = await request(app)
      .post(`${API}/vendor/products`)
      .set(v)
      .send({
        type: 'part',
        name: 'Carbon Brush Set for GSB 500',
        category: drills._id,
        brand: 'Bosch',
        pricing: { mrp: 30_000, price: 24_900, gstRate: 18 },
        inventory: { stock: 40, moq: 2, unit: 'set' },
        compatibleWith: [machine._id],
        compatibleModels: ['GSB 500 RE'],
        publish: true,
      })
      .expect(201);
    await request(app)
      .post(`${API}/admin/products/${part.body.data._id}/review`)
      .set(bearer(admin.accessToken))
      .send({ action: 'approve' })
      .expect(200);

    list = (await request(app).get(`${API}/public/products?category=power-tools&sort=price_asc`).expect(200)).body;
    expect(list.data.map((p) => p.type)).toEqual(['part', 'machinery']);
    expect(list.meta.total).toBe(2);
    expect(list.meta.facets.brands).toEqual([{ value: 'Bosch', count: 2 }]);

    const search = (await request(app).get(`${API}/public/products?q=impact`).expect(200)).body;
    expect(search.data.map((p) => p.slug)).toEqual(['bosch-gsb-500w-impact-drill']);

    const detail = (await request(app).get(`${API}/public/products/${machine.slug}`).expect(200)).body.data;
    expect(detail.breadcrumbs.map((b) => b.slug)).toEqual(['power-tools', 'drills']);
    expect(detail.spareParts.map((p) => p.name)).toEqual(['Carbon Brush Set for GSB 500']);
    expect(detail.product.vendor.store.name).toBe('Acme Tools');
    expect(detail.product).not.toHaveProperty('moderation');
  });

  it('editing a live product sends it back to review, but stock/price edits do not', async () => {
    const v = bearer(vendor.accessToken);
    const quick = await request(app)
      .patch(`${API}/vendor/products/${machine._id}/stock`)
      .set(v)
      .send({ stock: 3, price: 379_900 })
      .expect(200);
    expect(quick.body.data).toMatchObject({ status: 'active', inventory: { stock: 3 }, pricing: { price: 379_900 } });

    const edited = await request(app)
      .patch(`${API}/vendor/products/${machine._id}`)
      .set(v)
      .send({ name: 'Bosch GSB 500W Professional Impact Drill' })
      .expect(200);
    expect(edited.body.data.status).toBe('pending');
    await request(app).get(`${API}/public/products/${machine.slug}`).expect(404);

    await setModeration({ autoApproveProducts: true });
    await request(app)
      .post(`${API}/admin/products/${machine._id}/review`)
      .set(bearer(admin.accessToken))
      .send({ action: 'approve' })
      .expect(200);
    const again = await request(app)
      .patch(`${API}/vendor/products/${machine._id}`)
      .set(v)
      .send({ description: 'Now with more torque.' })
      .expect(200);
    expect(again.body.data.status).toBe('active');
    await setModeration({ autoApproveProducts: false });
  });

  it("stops vendors from using another vendor's media", async () => {
    const other = await approvedVendor(app, admin.accessToken, {
      phone: '9100000009',
      storeName: 'Other Co',
      gstin: '07AAACR5055K1Z3',
      pan: 'AAACR5055K',
    });
    const theirs = (await upload(app, other.accessToken, 'products', [await testImage({ width: 400, height: 400 })]).expect(201)).body
      .data[0];
    const res = await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'tool',
        name: 'Thief',
        category: drills._id,
        images: [{ media: theirs._id }],
        pricing: { mrp: 100, price: 100, gstRate: 18 },
        inventory: { stock: 1 },
      })
      .expect(403);
    expect(res.body.error.code).toBe('MEDIA_FORBIDDEN');
  });

  it('suspending a vendor hides their products and signs them out', async () => {
    const a = bearer(admin.accessToken);
    await request(app).post(`${API}/admin/vendors/${vendor.account._id}/suspend`).set(a).send({ note: 'KYC expired' }).expect(200);
    expect((await request(app).get(`${API}/public/products?category=power-tools`)).body.meta.total).toBe(0);
    await request(app).get(`${API}/vendor/me`).set(bearer(vendor.accessToken)).expect(403);

    await request(app).post(`${API}/admin/vendors/${vendor.account._id}/reinstate`).set(a).expect(200);
    expect((await request(app).get(`${API}/public/products?category=power-tools`)).body.meta.total).toBe(2);
  });

  it('refuses to delete a category that still has products', async () => {
    const res = await request(app).delete(`${API}/admin/categories/${root._id}`).set(bearer(admin.accessToken)).expect(409);
    expect(res.body.error.code).toBe('CATEGORY_HAS_CHILDREN');
  });
});

describe('settings & theme', () => {
  it('admin updates a module theme and the storefront sees it', async () => {
    await request(app)
      .put(`${API}/admin/settings/theme`)
      .set(bearer(admin.accessToken))
      .send({ vendor: { primary: '#0EA5E9' } })
      .expect(200);
    const pub = (await request(app).get(`${API}/public/settings`).expect(200)).body.data;
    expect(pub.theme.vendor).toMatchObject({ primary: '#0ea5e9', secondary: '#0f172a' });
    expect(pub.theme.user.primary).toBe('#e8590c');
    expect(pub).not.toHaveProperty('moderation');

    await request(app)
      .put(`${API}/admin/settings/theme`)
      .set(bearer(admin.accessToken))
      .send({ user: { primary: 'orange' } })
      .expect(422);
  });

  it('only admins can change settings', async () => {
    await request(app).put(`${API}/admin/settings/theme`).set(bearer(vendor.accessToken)).send({}).expect(401);
  });
});
