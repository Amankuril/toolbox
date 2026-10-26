import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';
import { sourceOf } from '#modules/analytics/analytics.service.js';
import { settingsService } from '#services/settings/settings.service.js';

let app;
let vendor;
let product;

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000001' });
  await setModeration({ autoApproveProducts: true });
  const cat = (await request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name: 'Saws' }).expect(201)).body.data;
  product = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({ type: 'tool', name: 'Hand Saw', category: cat._id, pricing: { mrp: 60_000, price: 50_000, gstRate: 18 }, inventory: { stock: 10 }, hsnCode: '8202', publish: true })
      .expect(201)
  ).body.data;
});
afterAll(stopTestApp);

const tick = () => new Promise((r) => setTimeout(r, 150));

describe('store analytics', () => {
  it('classifies where visits come from', () => {
    expect(sourceOf('https://l.wl.co/')).toBe('other');
    expect(sourceOf('', 'whatsapp')).toBe('whatsapp');
    expect(sourceOf('https://www.google.com/')).toBe('google');
    expect(sourceOf('')).toBe('direct');
  });

  it('counts views, unique visitors and sales for the seller', async () => {
    for (const visitor of ['visitor-aaaa', 'visitor-aaaa', 'visitor-bbbb']) {
      await request(app).post(`${API}/public/track`).send({ productId: product._id, visitor, referrer: 'https://www.google.com/' }).expect(204);
    }
    await request(app).post(`${API}/public/track`).send({ storeSlug: 'acme-tools', visitor: 'visitor-cccc' }).expect(204);
    await tick();

    const buyer = await otpSignIn(app, { phone: '9600000099', audience: 'user', register: { name: 'Buyer' } });
    const addressId = (
      await request(app)
        .post(`${API}/user/addresses`)
        .set(bearer(buyer.accessToken))
        .send({ name: 'Buyer', phone: '9600000099', line1: 'Road 1', city: 'Meerut', state: 'Uttar Pradesh', pincode: '250001' })
        .expect(201)
    ).body.data[0]._id;
    await request(app).put(`${API}/user/cart/items/${product._id}`).set(bearer(buyer.accessToken)).send({ quantity: 2 }).expect(200);
    await request(app).post(`${API}/user/orders/checkout`).set(bearer(buyer.accessToken)).send({ addressId, paymentMethod: 'cod' }).expect(201);

    const a = (await request(app).get(`${API}/vendor/analytics?days=7`).set(bearer(vendor.accessToken)).expect(200)).body.data;
    expect(a.totals.revenue.value).toBe(100_000);
    expect(a.totals.orders.value).toBe(1);
    expect(a.totals.views.value).toBe(4);
    expect(a.totals.visitors.value).toBe(3);
    expect(a.sources.google).toBe(3);
    expect(a.daily).toHaveLength(7);
    expect(a.topProducts[0]).toMatchObject({ name: 'Hand Saw', units: 2, views: 3 });
    expect(a.topCities[0]).toMatchObject({ city: 'Meerut', orders: 1 });
  });

  it('shows "people bought this recently" from real orders, above the minimum', async () => {
    const view = () => request(app).get(`${API}/public/products/${product.slug}`).expect(200);
    expect((await view()).body.data.product.recentBuyers).toBeNull();
    await settingsService.update('storefront', { recentBuyersMin: 1 }, { kind: 'system' });
    expect((await view()).body.data.product.recentBuyers).toEqual({ count: 1, days: 30 });
  });
});
