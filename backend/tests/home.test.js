import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clearHomeCache } from '#modules/home/home.service.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;
let agri;
let dairy;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000081' });
  await setModeration({ autoApproveProducts: true });
  const post = (name) => request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send({ name }).expect(201);
  agri = (await post('Agriculture')).body.data;
  dairy = (await post('Dairy')).body.data;
  const make = (name, category) =>
    request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'machinery',
        name,
        category,
        pricing: { mrp: 200_000, price: 150_000, gstRate: 18 },
        hsnCode: '8432',
        inventory: { stock: 5, moq: 1 },
        warranty: { months: 6 },
        publish: true,
      })
      .expect(201);
  for (let i = 0; i < 10; i++) await make(`Tiller ${i}`, agri._id);
  for (let i = 0; i < 4; i++) await make(`Milker ${i}`, dairy._id);
});

beforeEach(async () => {
  await clearHomeCache();
});
afterAll(() => stopTestApp());

const save = (sections) => request(app).put(`${API}/admin/home-sections`).set(bearer(admin.accessToken)).send({ sections });
const section = (id, kind, extra = {}) => ({ id, kind, enabled: true, title: '', subtitle: '', source: 'featured', category: null, rows: 1, shuffle: true, count: 3, ...extra });

describe('home page sections', () => {
  it('serves the default layout with one row per top department', async () => {
    const res = await request(app).get(`${API}/public/home`).expect(200);
    const ids = res.body.data.sections.map((s) => s.id);
    expect(ids[0]).toBe('parts-finder');
    expect(ids).toContain(`departments:${agri.slug}`);
    expect(ids).not.toContain('brands'); // no product has a brand yet, so the block is left out
    expect(ids).toContain('sell');
    expect(res.headers['cache-control']).toContain('no-store');
  });

  it('follows the admin order, hides disabled blocks and does not repeat products across sections', async () => {
    await save([
      section('new', 'products', { title: 'New in', source: 'newest', shuffle: false, rows: 2 }),
      section('agri', 'products', { source: 'category', category: agri._id }),
      section('stats', 'stats', { enabled: false }),
      section('sell', 'sellCta'),
    ]).expect(200);
    const { sections } = (await request(app).get(`${API}/public/home`).expect(200)).body.data;
    expect(sections.map((s) => s.id)).toEqual(['new', 'agri', 'sell']);
    const [newIn, agriRow] = sections;
    expect(newIn.products).toHaveLength(14); // two rows asked, all 14 fit
    expect(newIn.rows).toBe(2);
    expect(agriRow.title).toBe('Agriculture');
    expect(agriRow.viewAll).toBe(`/c/${agri.slug}`);
    // Everything was already in "New in", so the category row is topped up rather than left empty.
    expect(agriRow.products.length).toBeGreaterThanOrEqual(6);
  });

  it('gives later sections fresh products when there are enough', async () => {
    await save([
      section('dairy', 'products', { source: 'category', category: dairy._id }),
      section('agri', 'products', { source: 'category', category: agri._id }),
    ]).expect(200);
    const [d, a] = (await request(app).get(`${API}/public/home`).expect(200)).body.data.sections;
    const dairyIds = new Set(d.products.map((p) => p._id));
    expect(a.products.some((p) => dairyIds.has(p._id))).toBe(false);
  });

  it('rejects a category section without a category, and duplicate ids', async () => {
    expect((await save([section('x', 'products', { source: 'category' })])).status).toBe(422);
    expect((await save([section('x', 'stats'), section('x', 'brands')])).status).toBe(422);
  });
});
