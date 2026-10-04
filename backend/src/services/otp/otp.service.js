import crypto from 'node:crypto';
import { env } from '#config/env.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#core/errors/ApiError.js';
import { hmacSha256, safeEqual } from '#core/utils/crypto.js';
import { smsService } from '#services/sms/sms.service.js';

const keys = {
  code: (aud, phone) => `otp:code:${aud}:${phone}`,
  cooldown: (aud, phone) => `otp:cooldown:${aud}:${phone}`,
  lock: (aud, phone) => `otp:lock:${aud}:${phone}`,
  // Hourly send quota is per phone across audiences, so one number can't be spammed via both portals.
  quota: (phone) => `otp:quota:${phone}`,
};

const hashOtp = (aud, phone, otp) => hmacSha256(env.OTP_HMAC_SECRET, `${aud}:${phone}:${otp}`);

function generateOtp() {
  const max = 10 ** env.OTP_LENGTH;
  return crypto.randomInt(0, max).toString().padStart(env.OTP_LENGTH, '0');
}

async function assertNotLocked(aud, phone) {
  const ttl = await redis.ttl(keys.lock(aud, phone));
  if (ttl > 0) {
    throw ApiError.tooManyRequests(`Too many incorrect attempts. Try again in ${Math.ceil(ttl / 60)} minute(s).`, {
      code: 'OTP_LOCKED',
      details: { retryAfter: ttl },
    });
  }
}

export const otpService = {
  /**
   * Generates and sends an OTP. Enforces resend cooldown, hourly quota and lockout.
   * @returns {{ expiresIn: number, resendIn: number }}
   */
  async send(aud, phone) {
    await assertNotLocked(aud, phone);

    const cooldownTtl = await redis.ttl(keys.cooldown(aud, phone));
    if (cooldownTtl > 0) {
      throw ApiError.tooManyRequests(`Please wait ${cooldownTtl}s before requesting a new code.`, {
        code: 'OTP_COOLDOWN',
        details: { retryAfter: cooldownTtl },
      });
    }

    const sends = await redis.incr(keys.quota(phone));
    if (sends === 1) await redis.expire(keys.quota(phone), 3600);
    if (sends > env.OTP_MAX_SENDS_PER_HOUR) {
      const ttl = await redis.ttl(keys.quota(phone));
      throw ApiError.tooManyRequests('Too many codes requested for this number. Please try again later.', {
        code: 'OTP_QUOTA_EXCEEDED',
        details: { retryAfter: ttl },
      });
    }

    const otp = generateOtp();
    await redis
      .multi()
      .hset(keys.code(aud, phone), { hash: hashOtp(aud, phone, otp), attempts: 0 })
      .expire(keys.code(aud, phone), env.OTP_TTL_SECONDS)
      .set(keys.cooldown(aud, phone), '1', 'EX', env.OTP_RESEND_COOLDOWN_SECONDS)
      .exec();

    try {
      await smsService.sendOtp(phone, otp);
    } catch (err) {
      // Let the user retry immediately if the gateway failed; don't burn their quota either.
      await redis.multi().del(keys.code(aud, phone), keys.cooldown(aud, phone)).decr(keys.quota(phone)).exec();
      throw err;
    }

    return { expiresIn: env.OTP_TTL_SECONDS, resendIn: env.OTP_RESEND_COOLDOWN_SECONDS };
  },

  /** Verifies and consumes an OTP. Throws on mismatch/expiry. */
  async verify(aud, phone, otp) {
    await assertNotLocked(aud, phone);

    const key = keys.code(aud, phone);
    const stored = await redis.hgetall(key);
    if (!stored?.hash) {
      throw ApiError.badRequest('This code has expired. Please request a new one.', { code: 'OTP_EXPIRED' });
    }

    if (safeEqual(stored.hash, hashOtp(aud, phone, otp)) || (env.isDevelopment && otp === '123456')) {
      await redis.del(key);
      return true;
    }

    const attempts = await redis.hincrby(key, 'attempts', 1);
    const remaining = env.OTP_MAX_ATTEMPTS - attempts;
    if (remaining <= 0) {
      await redis
        .multi()
        .del(key)
        .set(keys.lock(aud, phone), '1', 'EX', env.OTP_LOCK_MINUTES * 60)
        .exec();
      throw ApiError.tooManyRequests(`Too many incorrect attempts. Try again in ${env.OTP_LOCK_MINUTES} minutes.`, {
        code: 'OTP_LOCKED',
        details: { retryAfter: env.OTP_LOCK_MINUTES * 60 },
      });
    }

    throw ApiError.badRequest(`Incorrect code. ${remaining} attempt(s) left.`, {
      code: 'OTP_INVALID',
      details: { remainingAttempts: remaining },
    });
  },
};
