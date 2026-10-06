import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Admin } from '#modules/admins/admin.model.js';
import { hashPassword } from '#modules/auth/auth.service.js';
import { API, approvedVendor, bearer, createAdmin, startTestApp, stopTestApp } from './helpers.js';

let app;
let root;
let vendor;

async function login(email, password = 'Staff!pass123') {
  const res = await request(app).post(`${API}/auth/admin/login`).send({ email, password }).expect(200);
  return { token: res.body.data.accessToken, account: res.body.data.account };
}

async function staff(email, permissions) {
  const created = (
    await request(app)
      .post(`${API}/admin/admins`)
      .set(bearer(root.accessToken))
      .send({ name: 'Staff', email, password: 'Staff!pass123', role: 'admin', ...(permissions !== undefined ? { permissions } : {}) })
      .expect(201)
  ).body.data;
  return { ...(await login(email)), id: created._id };
}

beforeAll(async () => {
  app = await startTestApp();
  root = await createAdmin(app);
  vendor = await approvedVendor(app, root.accessToken, { phone: '9900000001' });
});
afterAll(stopTestApp);

describe('admin permissions', () => {
  it('a customers-only admin sees customers and nothing else', async () => {
    const s = await staff('support@toolbox.test', { customers: 'view' });
    expect(s.account.permissions).toMatchObject({ customers: 'view', orders: 'none', settings: 'none' });
    expect(s.account.fullAccess).toBe(false);
    const A = bearer(s.token);
    await request(app).get(`${API}/admin/users`).set(A).expect(200);
    for (const path of ['/orders', '/products', '/vendors', '/settings', '/dashboard', '/admins', '/shipping/warehouses']) {
      const res = await request(app).get(`${API}/admin${path}`).set(A).expect(403);
      expect(['PERMISSION_DENIED', 'INSUFFICIENT_ROLE']).toContain(res.body.error.code);
    }
    // View-only: can read, can't change.
    const users = (await request(app).get(`${API}/admin/users`).set(A).expect(200)).body.data;
    if (users[0]) {
      const res = await request(app).patch(`${API}/admin/users/${users[0]._id}/status`).set(A).send({ status: 'blocked' }).expect(403);
      expect(res.body.error.message).toContain('view-only');
    }
  });

  it('manage access allows changes; permission changes apply on the next request', async () => {
    const s = await staff('ops@toolbox.test', { orders: 'manage', products: 'view' });
    const A = bearer(s.token);
    await request(app).get(`${API}/admin/orders`).set(A).expect(200);
    await request(app).get(`${API}/admin/shipping/status`).set(A).expect(200);
    // Products view can look vendors up (bulk upload picker) but never see bank details.
    await request(app).get(`${API}/admin/vendors`).set(A).expect(200);
    await request(app).get(`${API}/admin/vendors/${vendor.account._id}`).set(A).expect(200);
    await request(app).get(`${API}/admin/vendors/${vendor.account._id}/bank-account`).set(A).expect(403);
    await request(app).post(`${API}/admin/vendors/${vendor.account._id}/suspend`).set(A).send({ reason: 'x' }).expect(403);

    await request(app)
      .patch(`${API}/admin/admins/${s.id}`)
      .set(bearer(root.accessToken))
      .send({ permissions: { products: 'view' } })
      .expect(200);
    await request(app).get(`${API}/admin/orders`).set(A).expect(403);
    const me = (await request(app).get(`${API}/admin/me`).set(A).expect(200)).body.data;
    expect(me.permissions.orders).toBe('none');
  });

  it('only super admins manage admins, and nobody edits their own permissions', async () => {
    const s = await staff('cat@toolbox.test', { categories: 'manage' });
    await request(app).get(`${API}/admin/admins`).set(bearer(s.token)).expect(403);
    await request(app)
      .post(`${API}/admin/admins`)
      .set(bearer(s.token))
      .send({ name: 'x', email: 'x@toolbox.test', password: 'Staff!pass123', role: 'super_admin' })
      .expect(403);
    const rootMe = (await request(app).get(`${API}/admin/me`).set(bearer(root.accessToken)).expect(200)).body.data;
    await request(app)
      .patch(`${API}/admin/admins/${rootMe._id}`)
      .set(bearer(root.accessToken))
      .send({ permissions: { orders: 'view' } })
      .expect(403);
    await request(app)
      .patch(`${API}/admin/admins/${s.id}`)
      .set(bearer(root.accessToken))
      .send({ permissions: { bogus: 'manage' } })
      .expect(422);
  });

  it('admins created before permissions existed keep full access', async () => {
    await Admin.create({ name: 'Old', email: 'old@toolbox.test', role: 'admin', passwordHash: await hashPassword('Staff!pass123') });
    const s = await login('old@toolbox.test');
    expect(s.account.fullAccess).toBe(true);
    await request(app).get(`${API}/admin/settings`).set(bearer(s.token)).expect(200);
    await request(app).get(`${API}/admin/dashboard`).set(bearer(s.token)).expect(200);
  });

  it('uploads stay open to any admin; the media library needs its own permission', async () => {
    const s = await staff('banners@toolbox.test', { banners: 'manage' });
    await request(app).get(`${API}/admin/media`).set(bearer(s.token)).expect(403);
  });
});
