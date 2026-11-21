import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Setting } from '#modules/settings/setting.model.js';
import { deliveryFee, deliverySlabsSchema, MAX_SLAB_AMOUNT, normaliseSlabs } from '#modules/shipping/delivery.slabs.js';
import { settingsService } from '#services/settings/settings.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

// ₹0 up to ₹2,000 → ₹200 · ₹2,000 up to ₹5,000 → ₹400 · ₹5,000 up to ₹10,000 → free · above → free (last slab's fee)
const SLABS = [
  { from: 0, to: 200_000, fee: 20_000 },
  { from: 200_000, to: 500_000, fee: 40_000 },
  { from: 500_000, to: 1_000_000, fee: 0 },
];
const issues = (slabs) => deliverySlabsSchema.safeParse(slabs).error?.issues.map((i) => i.message) ?? [];

describe('delivery slabs', () => {
  it('charges the slab the order value falls in; an order of exactly a slab\'s "to" is in the next slab', () => {
    expect(deliveryFee(1, SLABS)).toBe(20_000);
    expect(deliveryFee(199_999, SLABS)).toBe(20_000);
    expect(deliveryFee(200_000, SLABS)).toBe(40_000);
    expect(deliveryFee(499_999, SLABS)).toBe(40_000);
    expect(deliveryFee(500_000, SLABS)).toBe(0);
  });

  it('charges orders above the last slab the last slab\'s fee', () => {
    const paid = [{ from: 0, to: 200_000, fee: 20_000 }, { from: 200_000, to: 500_000, fee: 40_000 }];
    expect(deliveryFee(500_000, paid)).toBe(40_000);
    expect(deliveryFee(1_200_000, paid)).toBe(40_000);
    expect(deliveryFee(99_000_000, SLABS)).toBe(0);
  });

  it('never charges an empty order, and no slabs means free delivery', () => {
    expect(deliveryFee(0, SLABS)).toBe(0);
    expect(deliveryFee(150_000, [])).toBe(0);
    expect(deliveryFee(150_000, undefined)).toBe(0);
  });

  it('starts at ₹0, chains each slab from the previous "to", and refuses overlaps and gaps', () => {
    expect(issues(SLABS)).toEqual([]);
    expect(issues([])).toEqual([]);
    expect(issues([{ from: 100, to: 200_000, fee: 1 }])).toEqual(['The first slab must start from ₹0']);
    // Overlap: slab 2 starts inside slab 1.
    expect(issues([{ from: 0, to: 200_000, fee: 1 }, { from: 150_000, to: 500_000, fee: 2 }])).toEqual([
      'Slab 2 must start from ₹2,000, where slab 1 ends',
    ]);
    // Gap: slab 2 starts after slab 1 ends.
    expect(issues([{ from: 0, to: 200_000, fee: 1 }, { from: 250_000, to: 500_000, fee: 2 }])).toEqual([
      'Slab 2 must start from ₹2,000, where slab 1 ends',
    ]);
    expect(issues([{ from: 0, to: 0, fee: 1 }])).toHaveLength(2);
    expect(issues([{ from: 0, to: 200_000, fee: 1 }, { from: 200_000, to: 200_000, fee: 2 }])).toEqual(['Slab 2 must end above ₹2,000']);
    expect(deliverySlabsSchema.safeParse([{ from: 0, to: 100, fee: -1 }]).success).toBe(false);
  });

  it('brings older settings over to slabs', () => {
    expect(normaliseSlabs({ flatFee: 0, freeAbove: 500_000 })).toEqual([]);
    expect(normaliseSlabs({ flatFee: 10_000, freeAbove: 0 })).toEqual([{ from: 0, to: MAX_SLAB_AMOUNT, fee: 10_000 }]);
    expect(normaliseSlabs({ flatFee: 10_000, freeAbove: 500_000 })).toEqual([
      { from: 0, to: 500_000, fee: 10_000 },
      { from: 500_000, to: MAX_SLAB_AMOUNT, fee: 0 },
    ]);
    expect(normaliseSlabs({ deliverySlabs: [{ upTo: 200_000, fee: 1 }, { upTo: null, fee: 2 }] })).toEqual([
      { from: 0, to: 200_000, fee: 1 },
      { from: 200_000, to: MAX_SLAB_AMOUNT, fee: 2 },
    ]);
    expect(normaliseSlabs({ deliverySlabs: SLABS, flatFee: 5 })).toBe(SLABS);
  });
});

let app;
let admin;
let vendor;
let buyer;
let product;
let addressId;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9610000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Sprayers' }).expect(201)).body
    .data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'tool',
        name: 'Knapsack Sprayer 16L',
        category: cat._id,
        pricing: { mrp: 150_000, price: 100_000, gstRate: 18 },
        inventory: { stock: 50, moq: 1, maxOrderQty: 20 },
        hsnCode: '8424',
        publish: true,
      })
      .expect(201)
  ).body.data;
  buyer = await otpSignIn(app, { phone: '9610000099', audience: 'user', register: { name: 'Slab Buyer' } });
  addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(bearer(buyer.accessToken))
      .send({ name: 'Buyer', phone: '9610000099', line1: 'Gat 7', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
      .expect(201)
  ).body.data[0]._id;
  await settingsService.update('payments', { codEnabled: true, codMaxOrderValue: 0 }, { kind: 'system' });
});
afterAll(stopTestApp);

const A = () => bearer(admin.accessToken);
const U = () => bearer(buyer.accessToken);
const setQty = async (quantity) =>
  (await request(app).put(`${API}/user/cart/items/${product._id}`).set(U()).send({ quantity }).expect(200)).body.data.summary;

describe('admin delivery charges', () => {
  it('saves valid slabs and refuses overlapping ones', async () => {
    const bad = await request(app)
      .put(`${API}/admin/settings/shipping`)
      .set(A())
      .send({ deliverySlabs: [{ from: 0, to: 200_000, fee: 1 }, { from: 150_000, to: 500_000, fee: 2 }] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details).toEqual([{ path: 'deliverySlabs.1.from', message: 'Slab 2 must start from ₹2,000, where slab 1 ends' }]);

    const saved = (await request(app).put(`${API}/admin/settings/shipping`).set(A()).send({ deliverySlabs: SLABS }).expect(200)).body.data;
    expect(saved.shipping.deliverySlabs).toEqual(SLABS);
    expect((await request(app).get(`${API}/public/settings`).expect(200)).body.data.shipping).toEqual({ deliverySlabs: SLABS });
  });

  it('keeps the slabs when other shipping settings are saved', async () => {
    const saved = (
      await request(app)
        .put(`${API}/admin/settings/shipping`)
        .set(A())
        .send({ defaultPackage: { weightGrams: 800, lengthCm: 30, widthCm: 20, heightCm: 10 } })
        .expect(200)
    ).body.data;
    expect(saved.shipping.deliverySlabs).toEqual(SLABS);
  });
});

describe('cart and checkout', () => {
  it('moves through the slabs as the cart grows, with the boundary in the higher slab', async () => {
    expect(await setQty(1)).toMatchObject({ subtotal: 100_000, shipping: 20_000, total: 120_000 });
    expect(await setQty(2)).toMatchObject({ subtotal: 200_000, shipping: 40_000, total: 240_000 });
    expect(await setQty(5)).toMatchObject({ subtotal: 500_000, shipping: 0, total: 500_000 });
    // Above the last slab (₹10,000): the last slab's fee.
    expect(await setQty(12)).toMatchObject({ subtotal: 1_200_000, shipping: 0 });
  });

  it('matches the order value after the coupon discount', async () => {
    await request(app)
      .post(`${API}/vendor/coupons`)
      .set(bearer(vendor.accessToken))
      .send({ code: 'SLAB500', type: 'flat', value: 50_000 })
      .expect(201);
    await setQty(5);
    const summary = (await request(app).put(`${API}/user/cart/coupon`).set(U()).send({ code: 'SLAB500' }).expect(200)).body.data.summary;
    // ₹5,000 − ₹500 = ₹4,500 falls back into the ₹400 slab.
    expect(summary).toMatchObject({ subtotal: 500_000, discount: 50_000, shipping: 40_000, total: 490_000 });
    await request(app).delete(`${API}/user/cart/coupon`).set(U()).expect(200);
  });

  it('charges the order the same fee the cart showed', async () => {
    await setQty(3);
    const order = (await request(app).post(`${API}/user/orders/checkout`).set(U()).send({ addressId, paymentMethod: 'cod' }).expect(201)).body
      .data.order;
    expect(order.amounts).toMatchObject({ subtotal: 300_000, shipping: 40_000, total: 340_000 });
  });
});

describe('settings saved before slabs', () => {
  it('turn a flat fee with free-above into two slabs', async () => {
    const stored = (await Setting.findOne({ key: 'shipping' }).lean()).value;
    const { deliverySlabs: _drop, ...rest } = stored;
    await Setting.updateOne({ key: 'shipping' }, { value: { ...rest, flatFee: 15_000, freeAbove: 300_000 } });
    await settingsService.invalidate();

    expect((await settingsService.get('shipping')).deliverySlabs).toEqual([
      { from: 0, to: 300_000, fee: 15_000 },
      { from: 300_000, to: MAX_SLAB_AMOUNT, fee: 0 },
    ]);
    expect(await setQty(2)).toMatchObject({ subtotal: 200_000, shipping: 15_000 });
    expect(await setQty(3)).toMatchObject({ subtotal: 300_000, shipping: 0 });
  });
});
