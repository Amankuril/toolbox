import fs from 'node:fs/promises';
import sharp from 'sharp';
import request from 'supertest';
import mongoose from 'mongoose';
import { connectDatabase } from '#config/db.js';
import { env } from '#config/env.js';
import { connectRedis, disconnectRedis, redis } from '#config/redis.js';
import { Admin } from '#modules/admins/admin.model.js';
import { hashPassword } from '#modules/auth/auth.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { smsService } from '#services/sms/sms.service.js';
import { createApp } from '../src/app.js';

export const API = '/api/v1';

export async function startTestApp() {
  await Promise.all([connectDatabase(), connectRedis()]);
  await Promise.all(Object.values(mongoose.models).map((m) => m.init()));
  return createApp();
}

export async function stopTestApp() {
  const keys = await redis.keys('*');
  // ioredis applies keyPrefix to commands but KEYS returns full names, so strip it before DEL.
  if (keys.length) await redis.del(...keys.map((k) => k.slice(env.REDIS_KEY_PREFIX.length)));
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  await disconnectRedis();
  await fs.rm(env.LOCAL_UPLOAD_DIR, { recursive: true, force: true });
}

export function lastOtp(phone) {
  const msg = smsService.provider.lastMessageTo(phone);
  return msg?.text.match(/\d{6}/)?.[0];
}

/** Runs the full OTP flow and returns { accessToken, cookie, account }. Registers if needed. */
export async function otpSignIn(app, { phone, audience, register }) {
  await redis.del(`otp:cooldown:${audience}:+91${phone}`);
  const send = await request(app).post(`${API}/auth/otp/send`).send({ phone, audience });
  if (send.status !== 200) throw new Error(`otp send failed: ${JSON.stringify(send.body)}`);

  const verify = await request(app)
    .post(`${API}/auth/otp/verify`)
    .send({ phone, audience, otp: lastOtp(`+91${phone}`) });
  if (verify.status !== 200) throw new Error(`otp verify failed: ${JSON.stringify(verify.body)}`);

  let res = verify;
  if (verify.body.data.status === 'onboarding_required') {
    res = await request(app)
      .post(`${API}/auth/${audience}/register`)
      .send({ onboardingToken: verify.body.data.onboardingToken, ...register });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
  }
  return { accessToken: res.body.data.accessToken, cookie: res.headers['set-cookie'], account: res.body.data.account };
}

export async function createAdmin(app, { email = 'root@toolbox.test', password = 'Sup3rSecret!pass', role = 'super_admin' } = {}) {
  await Admin.create({ name: 'Root', email, role, passwordHash: await hashPassword(password) });
  const res = await request(app).post(`${API}/auth/admin/login`).send({ email, password });
  return { accessToken: res.body.data.accessToken, cookie: res.headers['set-cookie'] };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export function testImage({ width = 2400, height = 1800, color = '#e8590c' } = {}) {
  return sharp({ create: { width, height, channels: 3, background: color } })
    .png()
    .toBuffer();
}

export function upload(app, token, folder, buffers) {
  let req = request(app).post(`${API}/${tokenAudience(token)}/media?folder=${folder}`).set(bearer(token));
  buffers.forEach((b, i) => {
    req = req.attach('files', b, { filename: `img-${i}.png`, contentType: 'image/png' });
  });
  return req;
}

function tokenAudience(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).aud;
}

export async function setModeration(values) {
  await settingsService.update('moderation', values, { kind: 'system' });
}

/** Onboards and approves a vendor end to end; returns their session. */
export async function approvedVendor(app, adminToken, { phone, storeName = 'Acme Tools', gstin = '27AAPFU0939F1ZV', pan = 'AAPFU0939F' }) {
  const session = await otpSignIn(app, { phone, audience: 'vendor', register: { contactName: 'Ravi Kumar', email: `${phone}@acme.test`, storeName } });
  const auth = bearer(session.accessToken);

  await request(app).put(`${API}/vendor/onboarding/business`).set(auth).send({ legalName: `${storeName} Pvt Ltd`, type: 'private_limited', gstin, pan }).expect(200);
  await request(app)
    .put(`${API}/vendor/onboarding/address`)
    .set(auth)
    .send({ line1: '12 MIDC Road', city: 'Pune', state: 'Maharashtra', pincode: '411019' })
    .expect(200);
  await request(app)
    .put(`${API}/vendor/onboarding/bank`)
    .set(auth)
    .send({ accountHolderName: storeName, accountNumber: '123456789012', confirmAccountNumber: '123456789012', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' })
    .expect(200);
  const docs = await upload(app, session.accessToken, 'documents', [await testImage({ width: 800, height: 600 }), await testImage({ width: 800, height: 600 })]);
  await request(app)
    .put(`${API}/vendor/onboarding/documents`)
    .set(auth)
    .send({ documents: [{ type: 'gst_certificate', media: docs.body.data[0]._id }, { type: 'cancelled_cheque', media: docs.body.data[1]._id }] })
    .expect(200);
  await request(app).post(`${API}/vendor/onboarding/submit`).set(auth).expect(200);
  await request(app).post(`${API}/admin/vendors/${session.account._id}/review`).set(bearer(adminToken)).send({ action: 'approve' }).expect(200);

  return session;
}
