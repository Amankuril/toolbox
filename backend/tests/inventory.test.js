import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let vendor;
let customer;
let category;
let addressId;

const V = () => bearer(vendor.accessToken);
const U = () => bearer(customer.accessToken);

const base = (extra = {}) => ({
  type: 'tool',
  name: 'Garden Pruning Shears',
  category: category._id,
  pricing: { mrp: 100_000, price: 80_000, gstRate: 18 },
  hsnCode: '8201',
  inventory: { stock: 10, moq: 1 },
  publish: true,
  ...extra,
});

const create = async (body, status = 201) => (await request(app).post(`${API}/vendor/products`).set(V()).send(body).expect(status)).body;
const publicProduct = async (slug) => (await request(app).get(`${API}/public/products/${slug}`).expect(200)).body.data.product;
const checkout = () => request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod' });

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9400000001' });
  await setModeration({ autoApproveProducts: true });
  category = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Garden' }).expect(201)).body
    .data;
  customer = await otpSignIn(app, { phone: '9400000099', audience: 'user', register: { name: 'Ravi' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(U())
      .send({ name: 'Ravi', phone: '9400000099', line1: 'Farm 3', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
      .expect(201)
  ).body.data[0]._id;
});
afterAll(stopTestApp);

describe('inventory basics', () => {
  it('auto-generates a SKU, validates barcodes and requires HSN/SAC to publish', async () => {
    const { data } = await create(base({ barcode: '8901234567890' }));
    expect(data.sku).toMatch(/^GAR-PRU-[0-9A-F]{6}$/);
    expect(data.barcode).toBe('8901234567890');

    const bad = await create(base({ name: 'Bad barcode', barcode: '12345' }), 422);
    expect(bad.error.details[0].path).toContain('barcode');

    const noHsn = await create(base({ name: 'No HSN', hsnCode: undefined }), 422);
    expect(noHsn.error.code).toBe('HSN_REQUIRED');
    // Drafts may be saved without it.
    await create(base({ name: 'Draft no HSN', hsnCode: undefined, publish: false }));
  });

  it('untracked products sell without a count; the availability switch overrides everything', async () => {
    const { data: p } = await create(base({ name: 'Made to order rake', inventory: { trackQuantity: false, stock: 0, moq: 1 } }));
    let pub = await publicProduct(p.slug);
    expect(pub).toMatchObject({ inStock: true, lowStock: null });
    expect(pub.inventory.stock).toBeNull();

    await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: 50 }).expect(200);
    expect((await checkout().expect(201)).body.data.order.items[0]).toMatchObject({ quantity: 50 });
    expect((await Product.findById(p._id).lean()).inventory.stock).toBe(0);

    await request(app).patch(`${API}/vendor/products/${p._id}/stock`).set(V()).send({ available: false }).expect(200);
    pub = await publicProduct(p.slug);
    expect(pub.inStock).toBe(false);
    const res = await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: 1 }).expect(409);
    expect(res.body.error.code).toBe('OUT_OF_STOCK');
    await request(app).patch(`${API}/vendor/products/${p._id}/stock`).set(V()).send({ stock: 5 }).expect(422);
  });

  it('shows "only N left" to buyers only when the low stock alert is on', async () => {
    const { data: quiet } = await create(base({ name: 'Quiet hoe', inventory: { stock: 3, moq: 1 } }));
    expect((await publicProduct(quiet.slug)).lowStock).toBeNull();
    const { data: loud } = await create(
      base({ name: 'Loud hoe', inventory: { stock: 3, moq: 1, lowStockAlert: true, lowStockThreshold: 5 } }),
    );
    expect((await publicProduct(loud.slug)).lowStock).toBe(3);
  });
});

describe('shipping details', () => {
  it('stores package weight and dimensions from the product form', async () => {
    const { data } = await create(base({ name: 'Boxed sprayer', shipping: { weightKg: 4.25, lengthCm: 42, widthCm: 30.5, heightCm: 20, dispatchDays: 3 } }));
    expect(data.shipping).toMatchObject({ weightKg: 4.25, lengthCm: 42, widthCm: 30.5, heightCm: 20, dispatchDays: 3 });
    await create(base({ name: 'Bad box', shipping: { lengthCm: -1 } }), 422);
  });
});

describe('variants', () => {
  const variantBody = (extra = {}) =>
    base({
      name: 'Work Gloves',
      variantOptions: [
        { name: 'Size', values: ['M', 'L'] },
        { name: 'Colour', values: ['Green', 'Black'] },
      ],
      variants: [
        { options: ['M', 'Green'], price: 30_000, mrp: 40_000, stock: 4 },
        { options: ['L', 'Black'], price: 35_000, mrp: 40_000, stock: 2, barcode: '012345678905' },
      ],
      ...extra,
    });

  it('rejects invalid combinations and bulk tiers', async () => {
    const dup = await create(
      variantBody({
        name: 'Dup gloves',
        variants: [
          { options: ['M', 'Green'], price: 30_000, mrp: 40_000 },
          { options: ['M', 'Green'], price: 30_000, mrp: 40_000 },
        ],
      }),
      422,
    );
    expect(dup.error.code).toBe('INVALID_VARIANTS');
    await create(variantBody({ name: 'Odd gloves', variants: [{ options: ['XXL', 'Green'], price: 1, mrp: 1 }] }), 422);
    await create(variantBody({ name: 'Tier gloves', bulkPricing: { tiers: [{ minQty: 10, price: 20_000 }] } }), 422);
  });

  it('prices and reserves stock per variant through cart and checkout', async () => {
    const { data: p } = await create(variantBody());
    expect(p.variants.map((v) => v.sku)).toEqual([`${p.sku}-M-GREEN`, `${p.sku}-L-BLACK`]);
    expect(p.pricing).toMatchObject({ price: 30_000, mrp: 40_000 });
    expect(p.inventory.stock).toBe(6);
    expect(p.quotes.enabled).toBe(false);

    const pub = await publicProduct(p.slug);
    expect(pub.variants[1]).toMatchObject({ title: 'L / Black', price: 35_000, inStock: true });
    expect(pub).not.toHaveProperty('barcode');

    const none = await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: 1 }).expect(422);
    expect(none.body.error.code).toBe('VARIANT_REQUIRED');
    const large = p.variants[1]._id;
    await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: 3, variantId: large }).expect(422);

    const cart = (await request(app).put(`${API}/user/cart/items/${p._id}`).set(U()).send({ quantity: 2, variantId: large }).expect(200))
      .body.data;
    expect(cart.items[0]).toMatchObject({ variantId: large, unitPrice: 35_000, lineTotal: 70_000, variant: { title: 'L / Black' } });

    const order = (await checkout().expect(201)).body.data.order;
    expect(order.items[0]).toMatchObject({ variant: { title: 'L / Black' }, sku: `${p.sku}-L-BLACK`, unitPrice: 35_000 });
    let saved = await Product.findById(p._id).lean();
    expect(saved.variants.map((v) => v.stock)).toEqual([4, 0]);
    expect(saved.inventory.stock).toBe(4);

    // Cancelling gives the units back to the same variant.
    await request(app).post(`${API}/user/orders/${order._id}/items/${order.items[0]._id}/cancel`).set(U()).send({}).expect(200);
    saved = await Product.findById(p._id).lean();
    expect(saved.variants.map((v) => v.stock)).toEqual([4, 2]);

    // Quick stock edits don't apply to variant products.
    await request(app).patch(`${API}/vendor/products/${p._id}/stock`).set(V()).send({ stock: 9 }).expect(422);
  });
});
