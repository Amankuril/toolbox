import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redis } from '#config/redis.js';
import { Session } from '#modules/auth/session.model.js';
import { API, bearer, createAdmin, lastOtp, otpSignIn, startTestApp, stopTestApp } from './helpers.js';

let app;

beforeAll(async () => {
  app = await startTestApp();
});
afterAll(stopTestApp);

const refreshCookie = (cookies, audience) => cookies.find((c) => c.startsWith(`tb_rt_${audience}=`)).split(';')[0];

describe('user OTP auth', () => {
  it('new number → onboarding → account, then signs straight in next time', async () => {
    const phone = '9876543210';
    await request(app).post(`${API}/auth/otp/send`).send({ phone, audience: 'user' }).expect(200);

    const verify = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ phone: `+91 ${phone}`, audience: 'user', otp: lastOtp(`+91${phone}`) })
      .expect(200);
    expect(verify.body.data.status).toBe('onboarding_required');
    expect(verify.headers['set-cookie']).toBeUndefined();

    const register = await request(app)
      .post(`${API}/auth/user/register`)
      .send({ onboardingToken: verify.body.data.onboardingToken, name: 'Asha Patil', accountType: 'business', businessName: 'Patil Agro' })
      .expect(201);
    expect(register.body.data.account).toMatchObject({ phone: `+91${phone}`, name: 'Asha Patil', accountType: 'business' });
    const cookie = refreshCookie(register.headers['set-cookie'], 'user');
    expect(register.headers['set-cookie'][0]).toMatch(/HttpOnly/i);
    expect(register.headers['set-cookie'][0]).toMatch(/Path=\/api\/v1\/auth\/user/);

    const me = await request(app).get(`${API}/user/me`).set(bearer(register.body.data.accessToken)).expect(200);
    expect(me.body.data.business.name).toBe('Patil Agro');

    // Access tokens are audience-bound: a user token cannot call vendor routes.
    await request(app).get(`${API}/vendor/me`).set(bearer(register.body.data.accessToken)).expect(401);

    const refreshed = await request(app).post(`${API}/auth/user/refresh`).set('Cookie', cookie).expect(200);
    expect(refreshed.body.data.account.name).toBe('Asha Patil');

    const again = await otpSignIn(app, { phone, audience: 'user' });
    expect(again.account.name).toBe('Asha Patil');
  });

  it('rejects invalid numbers and enforces the resend cooldown', async () => {
    await request(app).post(`${API}/auth/otp/send`).send({ phone: '12345', audience: 'user' }).expect(422);
    await request(app).post(`${API}/auth/otp/send`).send({ phone: '9000000001', audience: 'admin' }).expect(422);

    await request(app).post(`${API}/auth/otp/send`).send({ phone: '9000000001', audience: 'user' }).expect(200);
    const second = await request(app).post(`${API}/auth/otp/send`).send({ phone: '9000000001', audience: 'user' }).expect(429);
    expect(second.body.error.code).toBe('OTP_COOLDOWN');
    expect(second.headers['retry-after']).toBeDefined();
  });

  it('locks the number after too many wrong codes', async () => {
    const phone = '9000000002';
    await request(app).post(`${API}/auth/otp/send`).send({ phone, audience: 'user' }).expect(200);
    const wrong = lastOtp(`+91${phone}`) === '000000' ? '111111' : '000000';

    for (let i = 0; i < 4; i += 1) {
      const res = await request(app).post(`${API}/auth/otp/verify`).send({ phone, audience: 'user', otp: wrong }).expect(400);
      expect(res.body.error.code).toBe('OTP_INVALID');
    }
    const locked = await request(app).post(`${API}/auth/otp/verify`).send({ phone, audience: 'user', otp: wrong }).expect(429);
    expect(locked.body.error.code).toBe('OTP_LOCKED');
    await request(app).post(`${API}/auth/otp/send`).send({ phone, audience: 'user' }).expect(429);
  });

  it('keeps user and vendor accounts separate for the same number', async () => {
    const phone = '9000000003';
    await otpSignIn(app, { phone, audience: 'user', register: { name: 'Same Person' } });
    await redis.del(`otp:cooldown:vendor:+91${phone}`);
    await request(app).post(`${API}/auth/otp/send`).send({ phone, audience: 'vendor' }).expect(200);
    const verify = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ phone, audience: 'vendor', otp: lastOtp(`+91${phone}`) })
      .expect(200);
    expect(verify.body.data.status).toBe('onboarding_required');
  });

  it('rejects an onboarding token for the wrong audience', async () => {
    const phone = '9000000004';
    await request(app).post(`${API}/auth/otp/send`).send({ phone, audience: 'user' }).expect(200);
    const verify = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ phone, audience: 'user', otp: lastOtp(`+91${phone}`) })
      .expect(200);
    const res = await request(app)
      .post(`${API}/auth/vendor/register`)
      .send({ onboardingToken: verify.body.data.onboardingToken, contactName: 'X', email: 'x@y.test', storeName: 'X' })
      .expect(401);
    expect(res.body.error.code).toBe('ONBOARDING_TOKEN_INVALID');
  });
});

describe('refresh token rotation', () => {
  it('rotates on refresh and revokes the family when an old token is replayed', async () => {
    const { cookie } = await otpSignIn(app, { phone: '9000000010', audience: 'user', register: { name: 'Rotator' } });
    const first = refreshCookie(cookie, 'user');

    const r1 = await request(app).post(`${API}/auth/user/refresh`).set('Cookie', first).expect(200);
    const second = refreshCookie(r1.headers['set-cookie'], 'user');
    expect(second).not.toBe(first);

    // Replay of the first token outside the grace window = theft → whole family revoked.
    await Session.updateMany({ revokedReason: 'rotated' }, { revokedAt: new Date(Date.now() - 60_000) });
    const replay = await request(app).post(`${API}/auth/user/refresh`).set('Cookie', first).expect(401);
    expect(replay.body.error.code).toBe('SESSION_REVOKED');
    await request(app).post(`${API}/auth/user/refresh`).set('Cookie', second).expect(401);
  });

  it('logout revokes the session', async () => {
    const { cookie } = await otpSignIn(app, { phone: '9000000011', audience: 'user', register: { name: 'Leaver' } });
    const c = refreshCookie(cookie, 'user');
    await request(app).post(`${API}/auth/user/logout`).set('Cookie', c).expect(204);
    await request(app).post(`${API}/auth/user/refresh`).set('Cookie', c).expect(401);
  });
});

describe('admin auth', () => {
  it('signs in with email + password and locks after repeated failures', async () => {
    const { accessToken } = await createAdmin(app, { email: 'ops@toolbox.test', password: 'Correct!horse9' });
    const me = await request(app).get(`${API}/admin/me`).set(bearer(accessToken)).expect(200);
    expect(me.body.data).toMatchObject({ email: 'ops@toolbox.test', adminRole: 'super_admin' });

    for (let i = 0; i < 5; i += 1) {
      await request(app).post(`${API}/auth/admin/login`).send({ email: 'ops@toolbox.test', password: 'wrong' }).expect(401);
    }
    const locked = await request(app)
      .post(`${API}/auth/admin/login`)
      .send({ email: 'ops@toolbox.test', password: 'Correct!horse9' })
      .expect(429);
    expect(locked.body.error.code).toBe('LOGIN_LOCKED');
  });

  it('gives the same error for unknown emails and wrong passwords', async () => {
    const res = await request(app).post(`${API}/auth/admin/login`).send({ email: 'nobody@toolbox.test', password: 'whatever' }).expect(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('dummy OTP numbers', () => {
  it('accepts 123456 for numbers configured in DUMMY_NUMBERS in any environment and skips cooldown', async () => {
    const dummyPhone = '9777700001';
    process.env.DUMMY_NUMBERS = '9777700001, +919777700002';

    // 1. Send OTP should succeed with resendIn: 0
    const send1 = await request(app).post(`${API}/auth/otp/send`).send({ phone: dummyPhone, audience: 'user' }).expect(200);
    expect(send1.body.data.resendIn).toBe(0);

    // 2. Can request OTP again immediately without being blocked by cooldown
    await request(app).post(`${API}/auth/otp/send`).send({ phone: dummyPhone, audience: 'user' }).expect(200);

    // 3. Incorrect OTP is rejected
    const bad = await request(app).post(`${API}/auth/otp/verify`).send({ phone: dummyPhone, audience: 'user', otp: '999999' }).expect(400);
    expect(bad.body.error.code).toBe('OTP_INVALID');

    // 4. Dummy OTP 123456 is accepted successfully
    const verify = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ phone: `+91 ${dummyPhone}`, audience: 'user', otp: '123456' })
      .expect(200);
    expect(verify.body.data.status).toBe('onboarding_required');

    // 5. Test with second dummy number with +91 format
    const dummy2 = '9777700002';
    await request(app).post(`${API}/auth/otp/send`).send({ phone: dummy2, audience: 'vendor' }).expect(200);
    const verify2 = await request(app)
      .post(`${API}/auth/otp/verify`)
      .send({ phone: dummy2, audience: 'vendor', otp: '123456' })
      .expect(200);
    expect(verify2.body.data.status).toBe('onboarding_required');

    delete process.env.DUMMY_NUMBERS;
  });
});

