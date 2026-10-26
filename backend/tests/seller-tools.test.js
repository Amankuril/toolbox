import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp, testImage, upload } from './helpers.js';

let app;
let admin;
let acme;
let other;
let category;

const A = () => bearer(admin.accessToken);
const V = () => bearer(acme.accessToken);
const O = () => bearer(other.accessToken);

const product = (extra = {}) => ({
  type: 'tool',
  name: 'Impact Drill 13mm',
  category: category._id,
  hsnCode: '8467',
  pricing: { mrp: 500_000, price: 450_000, gstRate: 18 },
  inventory: { stock: 10, moq: 1 },
  publish: true,
  ...extra,
});

const images = async (session, n) =>
  (await upload(app, session.accessToken, 'products', await Promise.all(Array.from({ length: n }, () => testImage({ width: 400, height: 400 })))))
    .body.data;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  acme = await approvedVendor(app, admin.accessToken, { phone: '9400000801' });
  other = await approvedVendor(app, admin.accessToken, {
    phone: '9400000802',
    storeName: 'Other Tools',
    gstin: '07AAACR5055K1Z3',
    pan: 'AAACR5055K',
  });
  await setModeration({ autoApproveProducts: true });
  category = (await request(app).post(`${API}/admin/categories`).set(A()).send({ name: 'Drills' }).expect(201)).body.data;
});
afterAll(stopTestApp);

describe('gallery order (photos and videos interleaved)', () => {
  it('keeps the seller’s sequence on save, on edit and on the storefront', async () => {
    const [a, b] = await images(acme, 2);
    const created = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(V())
        .send(
          product({
            name: 'Gallery Drill',
            images: [{ media: a._id }, { media: b._id }],
            videos: [{ url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }],
            mediaOrder: ['image', 'video', 'image'],
          }),
        )
        .expect(201)
    ).body.data;
    expect(created.mediaOrder).toEqual(['image', 'video', 'image']);

    // Video first, photos swapped.
    const edited = (
      await request(app)
        .patch(`${API}/vendor/products/${created._id}`)
        .set(V())
        .send({ images: [{ media: b._id }, { media: a._id }], mediaOrder: ['video', 'image', 'image'] })
        .expect(200)
    ).body.data;
    expect(edited.images.map((i) => String(i.media))).toEqual([b._id, a._id]);
    expect(edited.mediaOrder).toEqual(['video', 'image', 'image']);

    const pub = (await request(app).get(`${API}/public/products/${created.slug}`).expect(200)).body.data.product;
    expect(pub.mediaOrder).toEqual(['video', 'image', 'image']);
    expect(pub.images.map((i) => String(i.media))).toEqual([b._id, a._id]);
  });

  it('repairs an order that does not match the media, and older products default to photos then videos', async () => {
    const [a] = await images(acme, 1);
    const created = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(V())
        .send(
          product({
            name: 'Mismatch Drill',
            images: [{ media: a._id }],
            videos: [{ url: 'https://vimeo.com/76979871' }],
            mediaOrder: ['video', 'video', 'video'],
          }),
        )
        .expect(201)
    ).body.data;
    expect(created.mediaOrder).toEqual(['video', 'image']);

    // Removing the video drops it from the order too.
    const edited = (await request(app).patch(`${API}/vendor/products/${created._id}`).set(V()).send({ videos: [] }).expect(200)).body.data;
    expect(edited.mediaOrder).toEqual(['image']);

    await Product.updateOne({ _id: created._id }, { $unset: { mediaOrder: '' }, videos: [{ source: 'vimeo', url: 'https://vimeo.com/1' }] });
    const legacy = (await request(app).get(`${API}/vendor/products/${created._id}`).set(V()).expect(200)).body.data;
    expect(legacy.mediaOrder).toEqual(['image', 'video']);
  });
});

describe('clone product', () => {
  let source;
  let media;

  beforeAll(async () => {
    media = await images(acme, 2);
    source = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(V())
        .send(product({ name: 'Rotary Hammer', sku: 'RH-1', images: media.map((m) => ({ media: m._id })) }))
        .expect(201)
    ).body.data;
  });

  it('a seller can save a copy of their own product with its photos, as a new listing', async () => {
    const copy = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(V())
        .send(product({ name: 'Rotary Hammer', sku: 'RH-2', cloneOf: source._id, images: source.images.map((i) => ({ media: i.media })) }))
        .expect(201)
    ).body.data;
    expect(copy._id).not.toBe(source._id);
    expect(copy.slug).not.toBe(source.slug);
    expect(copy.images.map((i) => i.url)).toEqual(source.images.map((i) => i.url));
  });

  it("another seller can't clone it or reuse its photos", async () => {
    const body = product({ name: 'Copycat', images: [{ media: media[0]._id }] });
    const noClone = await request(app).post(`${API}/vendor/products`).set(O()).send(body).expect(403);
    expect(noClone.body.error.code).toBe('MEDIA_FORBIDDEN');
    const clone = await request(app)
      .post(`${API}/vendor/products`)
      .set(O())
      .send({ ...body, cloneOf: source._id })
      .expect(422);
    expect(clone.body.error.code).toBe('CLONE_SOURCE_NOT_FOUND');
  });

  it("the cloned product's media is only unlocked for that product's own photos", async () => {
    const [unrelated] = await images(acme, 1);
    const res = await request(app)
      .post(`${API}/vendor/products`)
      .set(O())
      .send(product({ name: 'Sneaky', cloneOf: source._id, images: [{ media: unrelated._id }] }));
    expect(res.status).not.toBe(201);
  });

  it("the platform store can clone any seller's listing, photos included", async () => {
    const copy = (
      await request(app)
        .post(`${API}/admin/store/products`)
        .set(A())
        .send(product({ name: 'Rotary Hammer (Official)', cloneOf: source._id, images: source.images.map((i) => ({ media: i.media })) }))
        .expect(201)
    ).body.data;
    expect(copy.images).toHaveLength(2);
    expect(String(copy.vendor)).not.toBe(String(source.vendor));
  });
});

describe('bulk edit', () => {
  let simple;
  let second;
  let variantProduct;
  let othersProduct;

  beforeAll(async () => {
    const make = async (session, body) => (await request(app).post(`${API}/vendor/products`).set(bearer(session.accessToken)).send(body).expect(201)).body.data;
    simple = await make(acme, product({ name: 'Bulk One', sku: 'B-1' }));
    second = await make(acme, product({ name: 'Bulk Two', sku: 'B-2', brand: 'Bosch' }));
    variantProduct = await make(
      acme,
      product({
        name: 'Bulk Variant',
        variantOptions: [{ name: 'Size', values: ['S', 'L'] }],
        variants: [
          { options: ['S'], price: 100_000, mrp: 120_000, stock: 2 },
          { options: ['L'], price: 110_000, mrp: 130_000, stock: 3 },
        ],
      }),
    );
    othersProduct = await make(other, product({ name: 'Not Yours' }));
  });

  it('saves many rows at once and reports the rows that failed, without stopping the others', async () => {
    const { data } = (
      await request(app)
        .patch(`${API}/vendor/products/bulk`)
        .set(V())
        .send({
          items: [
            { _id: simple._id, name: 'Bulk One Renamed', price: 400_000, stock: 42, moq: 2, available: false },
            { _id: second._id, brand: '', sku: '', mrp: 300_000 }, // price 4,500 > new MRP 3,000
            { _id: variantProduct._id, stock: 9 },
            { _id: othersProduct._id, price: 1_000 },
          ],
        })
        .expect(200)
    ).body;

    expect(data.updated).toHaveLength(1);
    expect(data.updated[0]).toMatchObject({
      name: 'Bulk One Renamed',
      pricing: { price: 400_000, mrp: 500_000, gstRate: 18 },
      inventory: { stock: 42, moq: 2, available: false },
    });
    const failed = Object.fromEntries(data.failed.map((f) => [f._id, f]));
    expect(failed[second._id].details[0].path).toBe('price');
    expect(failed[variantProduct._id].code).toBe('HAS_VARIANTS');
    expect(failed[othersProduct._id].code).toBe('NOT_FOUND');

    // The failed row changed nothing.
    expect(await Product.findById(second._id).lean()).toMatchObject({ brand: 'Bosch', sku: 'B-2', pricing: { mrp: 500_000 } });
    expect(await Product.findById(othersProduct._id).lean()).toMatchObject({ pricing: { price: 450_000 } });
  });

  it('empty cells clear the brand and re-generate the SKU; GST null goes back to the category', async () => {
    await request(app)
      .patch(`${API}/admin/categories/${category._id}`)
      .set(A())
      .send({ tax: { hsnCode: '8467', gstRate: 12 } })
      .expect(200);
    const { data } = (
      await request(app)
        .patch(`${API}/vendor/products/bulk`)
        .set(V())
        .send({ items: [{ _id: second._id, brand: '', sku: '', gstRate: null }] })
        .expect(200)
    ).body;
    expect(data.failed).toEqual([]);
    expect(data.updated[0]).toMatchObject({ brand: null, pricing: { gstRate: 12 }, taxInherit: { gst: true } });
    expect(data.updated[0].sku).toMatch(/^BUL-TWO-/);
  });

  it('edits the short description, search tags and search keywords', async () => {
    const { data } = (
      await request(app)
        .patch(`${API}/vendor/products/bulk`)
        .set(V())
        .send({ items: [{ _id: second._id, shortDescription: 'Compact and light', tags: ['Drill', 'drill'], searchKeywords: ['Cordless Drill 18V'] }] })
        .expect(200)
    ).body;
    expect(data.failed).toEqual([]);
    expect(data.updated[0]).toMatchObject({ shortDescription: 'Compact and light', tags: ['drill'], searchKeywords: ['cordless drill 18v'] });
  });

  it('a duplicate SKU fails just that row', async () => {
    const { data } = (
      await request(app)
        .patch(`${API}/vendor/products/bulk`)
        .set(V())
        .send({ items: [{ _id: second._id, sku: 'RH-1' }] })
        .expect(200)
    ).body;
    expect(data.failed[0]).toMatchObject({ code: 'DUPLICATE_SKU' });
  });

  it('renaming a live listing sends it back to review when moderation is on', async () => {
    await setModeration({ autoApproveProducts: false });
    const { data } = (
      await request(app)
        .patch(`${API}/vendor/products/bulk`)
        .set(V())
        .send({ items: [{ _id: simple._id, name: 'Bulk One v2', stock: 5 }] })
        .expect(200)
    ).body;
    expect(data.updated[0].status).toBe('pending');
    // Price and stock alone never need review.
    const second2 = (
      await request(app)
        .patch(`${API}/vendor/products/bulk`)
        .set(V())
        .send({ items: [{ _id: second._id, stock: 1, price: 200_000, mrp: 250_000 }] })
        .expect(200)
    ).body.data;
    expect(second2.updated[0].status).toBe('active');
    await setModeration({ autoApproveProducts: true });
  });

  it('admins can bulk edit any seller’s products; bad input is rejected up front', async () => {
    const { data } = (
      await request(app)
        .patch(`${API}/admin/products/bulk`)
        .set(A())
        .send({ items: [{ _id: othersProduct._id, price: 300_000 }, { _id: second._id, moq: 3 }] })
        .expect(200)
    ).body;
    expect(data.failed).toEqual([]);
    expect(data.updated.map((p) => p.name).sort()).toEqual(['Bulk Two', 'Not Yours']);

    await request(app).patch(`${API}/vendor/products/bulk`).set(V()).send({ items: [] }).expect(422);
    await request(app)
      .patch(`${API}/vendor/products/bulk`)
      .set(V())
      .send({ items: [{ _id: simple._id }] })
      .expect(422);
    await request(app)
      .patch(`${API}/vendor/products/bulk`)
      .set(V())
      .send({ items: [{ _id: simple._id, stock: 1 }, { _id: simple._id, stock: 2 }] })
      .expect(422);
  });
});

describe('seller panel waits for approval', () => {
  it('a seller under review can finish their application but nothing else', async () => {
    const pending = await otpSignIn(app, {
      phone: '9400000809',
      audience: 'vendor',
      register: { contactName: 'New Seller', email: 'new@seller.test', storeName: 'New Seller Tools' },
    });
    const P = bearer(pending.accessToken);

    expect((await request(app).get(`${API}/vendor/me`).set(P).expect(200)).body.data.status).toBe('onboarding');
    await request(app)
      .put(`${API}/vendor/onboarding/address`)
      .set(P)
      .send({ line1: '1 Main Road', city: 'Pune', state: 'Maharashtra', pincode: '411001' })
      .expect(200);
    await upload(app, pending.accessToken, 'documents', [await testImage({ width: 400, height: 300 })]).expect(201);

    for (const [method, path] of [
      ['get', '/dashboard'],
      ['get', '/products'],
      ['post', '/products'],
      ['get', '/categories'],
      ['get', '/orders'],
      ['get', '/quotes'],
      ['get', '/coupons'],
      ['get', '/leads/counts'],
      ['get', '/product-imports'],
    ]) {
      const res = await request(app)[method](`${API}/vendor${path}`).set(P).send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code).toBe('VENDOR_NOT_APPROVED');
    }
  });
});

describe('media an admin added to a seller’s product', () => {
  it('the seller can still save and reorder the product afterwards', async () => {
    const [own] = await images(acme, 1);
    const p = (
      await request(app)
        .post(`${API}/vendor/products`)
        .set(V())
        .send(product({ name: 'Admin Edited', images: [{ media: own._id }] }))
        .expect(201)
    ).body.data;
    const adminImg = (await upload(app, admin.accessToken, 'products', [await testImage({ width: 300, height: 300 })])).body.data[0];
    await request(app)
      .patch(`${API}/admin/products/${p._id}`)
      .set(A())
      .send({ images: [{ media: own._id }, { media: adminImg._id }] })
      .expect(200);

    const res = await request(app)
      .patch(`${API}/vendor/products/${p._id}`)
      .set(V())
      .send({ images: [{ media: adminImg._id }, { media: own._id }] })
      .expect(200);
    expect(res.body.data.images.map((i) => String(i.media))).toEqual([adminImg._id, own._id]);
  });
});

describe('list filters', () => {
  it('filters products by stock level', async () => {
    const out = (await request(app).get(`${API}/vendor/products?stock=out`).set(V()).expect(200)).body.data;
    const inStock = (await request(app).get(`${API}/vendor/products?stock=in`).set(V()).expect(200)).body.data;
    expect(out.every((p) => p.inventory.available === false || p.inventory.stock <= 0)).toBe(true);
    expect(inStock.every((p) => p.inventory.available !== false)).toBe(true);
    await request(app).get(`${API}/vendor/products?stock=low&q=bulk`).set(V()).expect(200);
    await request(app).get(`${API}/vendor/orders?paymentMethod=cod&from=2020-01-01`).set(V()).expect(200);
  });
});
