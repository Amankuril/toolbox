import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resolveRange } from '#modules/analytics/analytics.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let vendor;
let other;
let saws;
let pumps;

const product = async (token, name, category, type = 'tool') =>
  (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(token))
      .send({ type, name, category, pricing: { mrp: 60_000, price: 50_000, gstRate: 18 }, inventory: { stock: 50 }, hsnCode: '8202', publish: true })
      .expect(201)
  ).body.data;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000111' });
  other = await approvedVendor(app, admin.accessToken, { phone: '9600000112', storeName: 'Pump House', gstin: '29AAGCB1234C1Z5', pan: 'AAGCB1234C' });
  await setModeration({ autoApproveProducts: true });
  const cat = (name, parent) => request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name, parent }).expect(201);
  const tools = (await cat('Tools')).body.data;
  saws = (await cat('Saws', tools._id)).body.data;
  const machines = (await cat('Machines')).body.data;
  pumps = (await cat('Pumps', machines._id)).body.data;
  const saw = await product(vendor.accessToken, 'Hand saw', saws._id);
  const pump = await product(other.accessToken, 'Water pump', pumps._id, 'machinery');

  const buyer = await otpSignIn(app, { phone: '9600000199', audience: 'user', register: { name: 'Buyer' } });
  const addressId = (
    await request(app)
      .post(`${API}/user/addresses`)
      .set(bearer(buyer.accessToken))
      .send({ name: 'Buyer', phone: '9600000199', line1: 'Road 1', city: 'Nashik', state: 'Maharashtra', pincode: '422001' })
      .expect(201)
  ).body.data[0]._id;
  await request(app).put(`${API}/user/cart/items/${saw._id}`).set(bearer(buyer.accessToken)).send({ quantity: 2 }).expect(200);
  await request(app).put(`${API}/user/cart/items/${pump._id}`).set(bearer(buyer.accessToken)).send({ quantity: 1 }).expect(200);
  await request(app).post(`${API}/user/orders/checkout`).set(bearer(buyer.accessToken)).send({ addressId, paymentMethod: 'cod' }).expect(201);
});
afterAll(stopTestApp);

const adminReport = (qs = '') => request(app).get(`${API}/admin/analytics${qs}`).set(bearer(admin.accessToken));

describe('analytics report', () => {
  it('picks day, week or month points by the length of the range, and compares with the window before', () => {
    expect(resolveRange({ days: 30 })).toMatchObject({ unit: 'day' });
    expect(resolveRange({ days: 90 })).toMatchObject({ unit: 'week' });
    expect(resolveRange({ days: 365 })).toMatchObject({ unit: 'month' });
    const r = resolveRange({ from: '2026-03-01', to: '2026-03-10' });
    expect(r.days).toHaveLength(10);
    expect(r.prevDays[0]).toBe('2026-02-19');
    expect(r.prevDays.at(-1)).toBe('2026-02-28');
  });

  it('gives admins the whole marketplace, split by seller and department', async () => {
    const a = (await adminReport('?days=7').expect(200)).body.data;
    expect(a.totals.revenue.value).toBe(150_000);
    expect(a.totals.orders.value).toBe(1);
    expect(a.series).toHaveLength(7);
    expect(a.series.reduce((n, p) => n + p.revenue, 0)).toBe(150_000);
    expect(a.topVendors.map((v) => v.name).sort()).toEqual(['Acme Tools', 'Pump House']);
    expect(a.byCategory.map((c) => c.name).sort()).toEqual(['Machines', 'Tools']);
    expect(a.heatmap.reduce((n, h) => n + h.orders, 0)).toBe(1);
    expect(a.topStates[0]).toMatchObject({ state: 'Maharashtra', revenue: 150_000 });
  });

  it('narrows to a category (with its sub-categories), a type, a payment method or a seller', async () => {
    const tools = (await adminReport(`?days=7&category=${saws._id}`).expect(200)).body.data;
    expect(tools.totals.revenue.value).toBe(100_000);
    expect(tools.totals.visitors.value).toBeNull(); // product filters show views only
    const machinery = (await adminReport('?days=7&type=machinery').expect(200)).body.data;
    expect(machinery.totals.revenue.value).toBe(50_000);
    const online = (await adminReport('?days=7&payment=razorpay').expect(200)).body.data;
    expect(online.totals.orders.value).toBe(0);
    const one = (await adminReport(`?days=7&vendor=${other.account._id}`).expect(200)).body.data;
    expect(one.totals.revenue.value).toBe(50_000);
    expect(one.topVendors).toEqual([]);
  });

  it('keeps sellers to their own sales, with the same filters and custom dates', async () => {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const mine = (await request(app).get(`${API}/vendor/analytics?from=${today}&to=${today}`).set(bearer(vendor.accessToken)).expect(200)).body.data;
    expect(mine.totals.revenue.value).toBe(100_000);
    expect(mine.range).toMatchObject({ from: today, to: today, unit: 'day' });
    expect(mine.byCategory).toEqual([expect.objectContaining({ name: 'Tools', revenue: 100_000 })]);
    await request(app).get(`${API}/vendor/analytics?from=${today}`).set(bearer(vendor.accessToken)).expect(422);
  });
});
