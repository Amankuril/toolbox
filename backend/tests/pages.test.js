import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { settingsService } from '#services/settings/settings.service.js';
import { API, bearer, createAdmin, startTestApp, stopTestApp } from './helpers.js';

let app;
let admin;

beforeAll(async () => {
  app = await startTestApp();
  admin = await createAdmin(app);
  await settingsService.update('branding', { siteName: 'Arihant Tools', supportEmail: 'help@arihant.test' }, { kind: 'system' });
});
afterAll(stopTestApp);

describe('information pages', () => {
  it('serves starting text filled with the branding until an admin edits it', async () => {
    const list = (await request(app).get(`${API}/public/pages`).expect(200)).body.data;
    expect(list.map((p) => p.slug)).toEqual(['terms-and-conditions', 'privacy-policy', 'cancellation-policy', 'support']);
    const terms = (await request(app).get(`${API}/public/pages/terms-and-conditions`).expect(200)).body.data;
    expect(terms.content).toContain('Arihant Tools');
    expect(terms.content).toContain('help@arihant.test');
    expect(terms.customised).toBe(false);
  });

  it('admins edit, unpublish and reset a page', async () => {
    const auth = bearer(admin.accessToken);
    const saved = (
      await request(app)
        .put(`${API}/admin/pages/privacy`)
        .set(auth)
        .send({ title: 'Privacy', content: '## Data\nWe keep it safe.', published: true, seo: { title: 'Our privacy promise' } })
        .expect(200)
    ).body.data;
    expect(saved).toMatchObject({ title: 'Privacy', customised: true, seo: { title: 'Our privacy promise' } });
    expect((await request(app).get(`${API}/public/pages/privacy-policy`).expect(200)).body.data.content).toBe('## Data\nWe keep it safe.');

    const html = await request(app).get('/pages/privacy-policy').expect(200);
    expect(html.text).toContain('<title data-ssr>Our privacy promise | Arihant Tools</title>');

    await request(app).put(`${API}/admin/pages/privacy`).set(auth).send({ title: 'Privacy', content: 'x', published: false }).expect(200);
    await request(app).get(`${API}/public/pages/privacy-policy`).expect(404);

    const reset = (await request(app).delete(`${API}/admin/pages/privacy`).set(auth).expect(200)).body.data;
    expect(reset).toMatchObject({ title: 'Privacy Policy', published: true, customised: false });
  });
});
