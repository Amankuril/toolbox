import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API, bearer, createAdmin, startTestApp, stopTestApp, testImage, upload } from './helpers.js';

const MP4 = Buffer.from('000000206674797069736f6d0000020069736f6d69736f32617663316d703431', 'hex');

let app;
let token;
let image;
let video;

beforeAll(async () => {
  app = await startTestApp();
  token = (await createAdmin(app)).accessToken;
  [image] = (await upload(app, token, 'banners', [await testImage({ width: 400, height: 200 })])).body.data;
  video = (
    await request(app)
      .post(`${API}/admin/media/videos?folder=banners`)
      .set(bearer(token))
      .attach('file', MP4, { filename: 'hero.mp4', contentType: 'video/mp4' })
      .expect(201)
  ).body.data;
});
afterAll(() => stopTestApp());

const post = (body) => request(app).post(`${API}/admin/banners`).set(bearer(token)).send(body);

describe('hero banner video and text', () => {
  it('lets a hero banner be just a video, with its words hidden', async () => {
    const res = await post({ title: 'Monsoon sale', placement: 'home_hero', video: { media: video.media }, showText: false }).expect(201);
    expect(res.body.data).toMatchObject({ showText: false, video: { url: expect.stringMatching(/\.mp4$/) } });
    expect(res.body.data.image).toBeUndefined();
    const live = (await request(app).get(`${API}/public/banners?placement=home_hero`).expect(200)).body.data;
    expect(live[0].video.url).toBe(res.body.data.video.url);
  });

  it('still needs an image everywhere else, and for a hero without a video', async () => {
    expect((await post({ title: 'Tile', placement: 'home_offer', video: { media: video.media } })).status).toBe(422);
    expect((await post({ title: 'Hero', placement: 'home_hero' })).status).toBe(422);
  });

  it('refuses an image where the video goes', async () => {
    expect((await post({ title: 'Hero', placement: 'home_hero', video: { media: image._id } })).status).toBe(422);
  });

  it('removes the video when cleared, but not if that leaves the hero with nothing to show', async () => {
    const b = (await post({ title: 'Both', placement: 'home_hero', image: { media: image._id }, video: { media: video.media } }).expect(201)).body.data;
    const cleared = await request(app).patch(`${API}/admin/banners/${b._id}`).set(bearer(token)).send({ video: null }).expect(200);
    expect(cleared.body.data.video).toBeUndefined();
    const empty = await request(app).patch(`${API}/admin/banners/${b._id}`).set(bearer(token)).send({ image: null });
    expect(empty.status).toBe(422);
  });
});
