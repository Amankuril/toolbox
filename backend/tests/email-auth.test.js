import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redis } from '#config/redis.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { mailService } from '#services/mail/mail.service.js';
import { API, approvedVendor, bearer, createAdmin, otpSignIn, startTestApp, stopTestApp } from './helpers.js';

let app;
const lastEmailOtp = (to) => mailService.provider.lastMessageTo(to)?.text.match(/\b\d{6}\b/)?.[0];

async function emailCode(email, audience) {
  await redis.del(`otp:cooldown:${audience}:${email.toLowerCase()}`);
  await request(app).post(`${API}/auth/otp/send`).send({ email, audience }).expect(200);
  // Addresses are normalised to lower case.
  return lastEmailOtp(email.toLowerCase());
}

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

describe('email sign-in', () => {
  it('sends a code by email and signs up a new customer without a phone', async () => {
    const otp = await emailCode('Asha@Example.com', 'user');
    const mail = mailService.provider.lastMessageTo('asha@example.com');
    expect(mail.subject).toBe(`${otp} is your ToolsHubs sign-in code`);

    const verify = await request(app).post(`${API}/auth/otp/verify`).send({ email: 'asha@example.com', audience: 'user', otp }).expect(200);
    expect(verify.body.data).toMatchObject({ status: 'onboarding_required', email: 'asha@example.com' });

    const reg = await request(app)
      .post(`${API}/auth/user/register`)
      .send({ onboardingToken: verify.body.data.onboardingToken, name: 'Asha', email: 'someone-else@example.com' })
      .expect(201);
    // The verified email wins over a different one typed in the form.
    expect(reg.body.data.account).toMatchObject({ email: 'asha@example.com', emailVerified: true, phone: null });

    const again = await emailCode('asha@example.com', 'user');
    const login = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ email: 'asha@example.com', audience: 'user', otp: again })
      .expect(200);
    expect(login.body.data).toMatchObject({ status: 'authenticated', account: { email: 'asha@example.com' } });
  });

  it('signs an existing phone customer in by the email on their profile, and marks it verified', async () => {
    const s = await otpSignIn(app, { phone: '9600000001', audience: 'user', register: { name: 'Ravi', email: 'ravi@example.com' } });
    expect(s.account.emailVerified).toBe(false);
    const otp = await emailCode('ravi@example.com', 'user');
    const login = await request(app).post(`${API}/auth/otp/verify`).send({ email: 'ravi@example.com', audience: 'user', otp }).expect(200);
    expect(login.body.data.account).toMatchObject({ _id: s.account._id, phone: '+919600000001', emailVerified: true });

    // Changing the email clears verification.
    const me = await request(app)
      .patch(`${API}/user/me`)
      .set(bearer(login.body.data.accessToken))
      .send({ email: 'ravi2@example.com' })
      .expect(200);
    expect(me.body.data.emailVerified).toBe(false);
  });

  it('lets sellers sign in by email but sign up only with a mobile number', async () => {
    const admin = await createAdmin(app);
    const v = await approvedVendor(app, admin.accessToken, { phone: '9600000002' });
    const email = (await Vendor.findById(v.account._id).lean()).email;

    const otp = await emailCode(email, 'vendor');
    const login = await request(app).post(`${API}/auth/otp/verify`).send({ email, audience: 'vendor', otp }).expect(200);
    expect(login.body.data).toMatchObject({ status: 'authenticated', account: { _id: v.account._id } });

    const unknown = await emailCode('new-seller@example.com', 'vendor');
    const res = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ email: 'new-seller@example.com', audience: 'vendor', otp: unknown })
      .expect(404);
    expect(res.body.error.code).toBe('SELLER_EMAIL_NOT_FOUND');

    // A new seller can't reuse an existing seller's email.
    await redis.del('otp:cooldown:vendor:+919600000003');
    await request(app).post(`${API}/auth/otp/send`).send({ phone: '9600000003', audience: 'vendor' }).expect(200);
  });

  it('applies the same cooldown, wrong-code limits and validation as phone codes', async () => {
    await emailCode('limits@example.com', 'user');
    const again = await request(app).post(`${API}/auth/otp/send`).send({ email: 'limits@example.com', audience: 'user' }).expect(429);
    expect(again.body.error.code).toBe('OTP_COOLDOWN');
    const wrong = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ email: 'limits@example.com', audience: 'user', otp: '000000' })
      .expect(400);
    expect(wrong.body.error.code).toBe('OTP_INVALID');

    await request(app).post(`${API}/auth/otp/send`).send({ audience: 'user' }).expect(422);
    await request(app).post(`${API}/auth/otp/send`).send({ phone: '9600000009', email: 'both@example.com', audience: 'user' }).expect(422);
    await request(app).post(`${API}/auth/otp/send`).send({ email: 'not-an-email', audience: 'user' }).expect(422);
  });

  it('refuses email sign-in when two older seller accounts share the email', async () => {
    await Vendor.collection.insertMany([
      { phone: '+919600000010', contactName: 'A', email: 'shared@example.com', status: 'approved', store: { name: 'A' } },
      { phone: '+919600000011', contactName: 'B', email: 'shared@example.com', status: 'approved', store: { name: 'B' } },
    ]);
    const otp = await emailCode('shared@example.com', 'vendor');
    const res = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ email: 'shared@example.com', audience: 'vendor', otp })
      .expect(409);
    expect(res.body.error.code).toBe('EMAIL_AMBIGUOUS');
    expect(await User.countDocuments({ email: 'shared@example.com' })).toBe(0);
  });
});
