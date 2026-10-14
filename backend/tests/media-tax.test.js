import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp, testImage, upload } from './helpers.js';

let app;
let admin;
let vendor;

const A = () => bearer(admin.accessToken);
const V = () => bearer(vendor.accessToken);

// Smallest headers file-type recognises as each container.
const MP4 = Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex');

const product = (category, extra = {}) => ({
  type: 'tool',
  name: 'Angle Grinder 100mm',
  category,
  pricing: { mrp: 400_000, price: 350_000 },
  inventory: { stock: 5, moq: 1 },
  publish: true,
  ...extra,
});

const createProduct = async (body, status = 201) =>
  (await request(app).post(`${API}/vendor/products`).set(V()).send(body).expect(status)).body;
const createCategory = async (body) => (await request(app).post(`${API}/admin/categories`).set(A()).send(body).expect(201)).body.data;
const updateCategory = (id, body) => request(app).patch(`${API}/admin/categories/${id}`).set(A()).send(body);

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  vendor = await approvedVendor(app, admin.accessToken, { phone: '9400000301' });
  await setModeration({ autoApproveProducts: true });
});
afterAll(stopTestApp);

describe('category HSN / GST defaults', () => {
  let tools;
  let grinders;

  beforeAll(async () => {
    tools = await createCategory({ name: 'Power Tools', tax: { hsnCode: '8467', gstRate: 18 } });
    // Sets nothing itself, so it inherits from Power Tools.
    grinders = await createCategory({ name: 'Grinders', parent: tools._id });
  });

  it('products without their own values take them from the nearest category up the tree', async () => {
    expect(tools.tax).toEqual({ hsnCode: '8467', gstRate: 18 });
    expect(grinders.tax).toEqual({ hsnCode: null, gstRate: null });

    const { data } = await createProduct(product(grinders._id));
    expect(data.status).toBe('active');
    expect(data).toMatchObject({ hsnCode: '8467', pricing: { gstRate: 18 }, taxInherit: { hsn: true, gst: true } });
  });

  it("a product's own HSN / GST overrides the category's and stays put when the category changes", async () => {
    const own = (
      await createProduct(
        product(grinders._id, { name: 'Bench Grinder', hsnCode: '846729', pricing: { mrp: 500_000, price: 450_000, gstRate: 28 } }),
      )
    ).data;
    const inherits = (await createProduct(product(grinders._id, { name: 'Die Grinder' }))).data;
    expect(own).toMatchObject({ hsnCode: '846729', pricing: { gstRate: 28 }, taxInherit: { hsn: false, gst: false } });

    await updateCategory(tools._id, { tax: { hsnCode: '846721', gstRate: 12 } }).expect(200);

    const [ownNow, inheritsNow] = await Promise.all([Product.findById(own._id).lean(), Product.findById(inherits._id).lean()]);
    expect(ownNow).toMatchObject({ hsnCode: '846729', pricing: { gstRate: 28 } });
    expect(inheritsNow).toMatchObject({ hsnCode: '846721', pricing: { gstRate: 12 } });

    // A sub-category's own value beats its parent's.
    await updateCategory(grinders._id, { tax: { gstRate: 5 } }).expect(200);
    expect(await Product.findById(inherits._id).lean()).toMatchObject({ hsnCode: '846721', pricing: { gstRate: 5 } });
  });

  it('clearing the product field switches it back to the category; 0% is a real rate', async () => {
    const { data } = await createProduct(
      product(grinders._id, { name: 'Polisher', hsnCode: '8467', pricing: { mrp: 9_000, price: 8_000, gstRate: 0 } }),
    );
    expect(data).toMatchObject({ pricing: { gstRate: 0 }, taxInherit: { gst: false } });

    const res = await request(app)
      .patch(`${API}/vendor/products/${data._id}`)
      .set(V())
      .send({ hsnCode: '', pricing: { mrp: 9_000, price: 8_000, gstRate: null } })
      .expect(200);
    expect(res.body.data).toMatchObject({ hsnCode: '846721', pricing: { gstRate: 5 }, taxInherit: { hsn: true, gst: true } });
  });

  it('moving a category re-applies the values its products inherit', async () => {
    const hand = await createCategory({ name: 'Hand Tools', tax: { hsnCode: '8205', gstRate: 12 } });
    const files = await createCategory({ name: 'Files', parent: tools._id });
    const { data } = await createProduct(product(files._id, { name: 'Flat File' }));
    expect(data).toMatchObject({ hsnCode: '846721', pricing: { gstRate: 12 } });

    await updateCategory(files._id, { parent: hand._id }).expect(200);
    expect(await Product.findById(data._id).lean()).toMatchObject({ hsnCode: '8205', pricing: { gstRate: 12 } });
  });

  it('refuses to clear values that listed products depend on, and needs them to publish', async () => {
    const res = await updateCategory(tools._id, { tax: { hsnCode: null, gstRate: null } }).expect(409);
    expect(res.body.error.code).toBe('CATEGORY_TAX_IN_USE');

    const bare = await createCategory({ name: 'Misc' });
    expect((await createProduct(product(bare._id, { name: 'Mystery Box' }), 422)).error.code).toBe('HSN_REQUIRED');
    expect((await createProduct(product(bare._id, { name: 'Mystery Box', hsnCode: '9999' }), 422)).error.code).toBe('GST_REQUIRED');
    // Drafts can wait for the category to get its values.
    const draft = (await createProduct(product(bare._id, { name: 'Mystery Box', publish: false }))).data;
    await updateCategory(bare._id, { tax: { hsnCode: '9603', gstRate: 18 } }).expect(200);
    expect(await Product.findById(draft._id).lean()).toMatchObject({ hsnCode: '9603', pricing: { gstRate: 18 } });
  });
});

describe('product videos and media from links', () => {
  let category;

  beforeAll(async () => {
    category = await createCategory({ name: 'Drills', tax: { hsnCode: '8467', gstRate: 18 } });
  });

  it('uploads a video file and keeps YouTube / Vimeo links as clean embeds, in order', async () => {
    const up = await request(app)
      .post(`${API}/vendor/media/videos?folder=products`)
      .set(V())
      .attach('file', MP4, { filename: 'demo.mp4', contentType: 'video/mp4' })
      .expect(201);
    expect(up.body.data).toMatchObject({ source: 'upload', url: expect.stringMatching(/\.mp4$/) });

    const { data } = await createProduct(
      product(category._id, {
        videos: [
          { url: 'https://youtu.be/dQw4w9WgXcQ?si=tracking' },
          { media: up.body.data.media, title: 'Unboxing' },
          { url: 'https://vimeo.com/76979871' },
        ],
      }),
    );
    expect(data.videos).toEqual([
      expect.objectContaining({ source: 'youtube', embedUrl: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ' }),
      expect.objectContaining({ source: 'upload', title: 'Unboxing', url: up.body.data.url }),
      expect.objectContaining({ source: 'vimeo', embedUrl: 'https://player.vimeo.com/video/76979871' }),
    ]);

    // Reordering and removing after saving.
    const res = await request(app)
      .patch(`${API}/vendor/products/${data._id}`)
      .set(V())
      .send({ videos: [{ url: 'https://vimeo.com/76979871' }, { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }] })
      .expect(200);
    expect(res.body.data.videos.map((v) => v.source)).toEqual(['vimeo', 'youtube']);

    const pub = await request(app).get(`${API}/public/products/${data.slug}`).expect(200);
    expect(pub.body.data.product.videos).toHaveLength(2);
  });

  it('rejects other links, non-videos, and images passed off as videos', async () => {
    const bad = await createProduct(product(category._id, { name: 'Bad link', videos: [{ url: 'https://example.com/watch?v=1' }] }), 422);
    expect(bad.error.code).toBe('INVALID_VIDEO_LINK');

    await request(app)
      .post(`${API}/vendor/media/videos?folder=products`)
      .set(V())
      .attach('file', Buffer.from('not a video at all'), { filename: 'x.mp4', contentType: 'video/mp4' })
      .expect(400);
    await request(app)
      .post(`${API}/vendor/media/videos?folder=vendors`)
      .set(V())
      .attach('file', MP4, { filename: 'x.mp4', contentType: 'video/mp4' })
      .expect(400);

    const img = (await upload(app, vendor.accessToken, 'products', [await testImage({ width: 400, height: 400 })]).expect(201)).body
      .data[0];
    const wrong = await createProduct(product(category._id, { name: 'Wrong type', videos: [{ media: img._id }] }), 422);
    expect(wrong.error.code).toBe('MEDIA_WRONG_TYPE');
  });

  it('from-url turns video links into embeds and refuses private hosts', async () => {
    const yt = await request(app)
      .post(`${API}/vendor/media/from-url`)
      .set(V())
      .send({ url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ', kind: 'video', folder: 'products' })
      .expect(201);
    expect(yt.body.data).toMatchObject({ source: 'youtube', thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg' });

    const local = await request(app)
      .post(`${API}/vendor/media/from-url`)
      .set(V())
      .send({ url: 'http://127.0.0.1:5000/secret.png', kind: 'image', folder: 'products' })
      .expect(422);
    expect(local.body.error.code).toBe('REMOTE_FETCH_FAILED');
  });

  it('admins can replace, reorder and remove a product’s images', async () => {
    const imgs = (
      await upload(app, vendor.accessToken, 'products', [
        await testImage({ width: 400, height: 400 }),
        await testImage({ width: 400, height: 400, color: '#228be6' }),
      ]).expect(201)
    ).body.data;
    const { data } = await createProduct(product(category._id, { name: 'Hammer Drill', images: imgs.map((m) => ({ media: m._id })) }));

    const res = await request(app)
      .patch(`${API}/admin/products/${data._id}`)
      .set(A())
      .send({ images: [{ media: imgs[1]._id }] })
      .expect(200);
    expect(res.body.data.images.map((i) => String(i.media))).toEqual([imgs[1]._id]);
  });
});
