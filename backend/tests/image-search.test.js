import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { visionService } from '#services/vision/vision.service.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let tillers;
let seen;

const photo = () => sharp({ create: { width: 64, height: 48, channels: 3, background: '#e07020' } }).png().toBuffer();

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000071' });
  await setModeration({ autoApproveProducts: true });
  const post = (body) => request(app).post(`${API}/admin/categories`).set(bearer(admin.accessToken)).send(body).expect(201);
  const agri = (await post({ name: 'Agriculture machinery' })).body.data;
  tillers = (await post({ name: 'Mini tiller', parent: agri._id })).body.data;
  await request(app)
    .post(`${API}/vendor/products`)
    .set(bearer(vendor.accessToken))
    .send({
      type: 'machinery',
      name: 'Neptune 1500W electric mini power weeder',
      brand: 'Neptune',
      category: tillers._id,
      pricing: { mrp: 1_999_900, price: 1_549_900, gstRate: 5 },
      hsnCode: '8432',
      inventory: { stock: 5, moq: 1 },
      warranty: { months: 12 },
      publish: true,
    })
    .expect(201);
});

afterAll(async () => {
  visionService._setProvider(null);
  await stopTestApp();
});

describe('search by image', () => {
  it('is off without a vision provider', async () => {
    visionService._setProvider(null);
    const res = await request(app).post(`${API}/public/image-search`).attach('file', await photo(), 'p.png');
    expect(res.status).toBe(404);
  });

  it('turns the photo into a search that finds the product, scoped to the category', async () => {
    visionService._setProvider({
      name: 'fake',
      identify: async (image, categories) => {
        seen = { image, categories };
        return {
          recognised: true,
          productType: 'mini power weeder',
          brand: 'Neptune',
          modelNumber: '',
          keywords: ['tiller', 'weeder'],
          categoryId: String(tillers._id),
        };
      },
    });
    const res = await request(app).post(`${API}/public/image-search`).attach('file', await photo(), 'p.png').expect(200);
    expect(seen.image.mediaType).toBe('image/jpeg');
    expect(seen.categories.map((c) => c.path)).toContain('Agriculture machinery > Mini tiller');
    expect(res.body.data).toMatchObject({ recognised: true, label: 'Neptune mini power weeder', category: { slug: tillers.slug } });
    expect(res.body.data.search).toMatchObject({ category: tillers.slug, total: 1 });
    expect(res.body.data.search.q).toContain('weeder');
  });

  it('says so when nothing is recognised', async () => {
    visionService._setProvider({ name: 'fake', identify: async () => ({ recognised: false, productType: '', brand: '', modelNumber: '', keywords: [], categoryId: '' }) });
    const res = await request(app).post(`${API}/public/image-search`).attach('file', await photo(), 'p.png').expect(200);
    expect(res.body.data).toMatchObject({ recognised: false, search: null });
  });

  it('rejects files that are not images', async () => {
    visionService._setProvider({ name: 'fake', identify: async () => null });
    const res = await request(app).post(`${API}/public/image-search`).attach('file', Buffer.from('hello'), { filename: 'a.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('advertises itself in public settings only when configured', async () => {
    const res = await request(app).get(`${API}/public/settings`).expect(200);
    expect(res.body.data.search).toEqual({ imageSearch: false });
  });
});
