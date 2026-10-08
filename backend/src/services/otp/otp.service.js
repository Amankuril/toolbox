import crypto from 'node:crypto';
import { env, isDummyNumber } from '#config/env.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#core/errors/ApiError.js';
import { hmacSha256, safeEqual } from '#core/utils/crypto.js';
import { mailService } from '#services/mail/mail.service.js';
import { smsService } from '#services/sms/sms.service.js';

/**
 * An OTP target is a phone in E.164 (+91…) or a lower-cased email address. Keys embed the
 * target itself, so a phone and an email never share codes, cooldowns or lockouts.
 */
const isEmail = (target) => target.includes('@');
const isDummy = (target) => !isEmail(target) && isDummyNumber(target);

function deliver(target, otp) {
  return isEmail(target) ? mailService.sendOtp(target, otp) : smsService.sendOtp(target, otp);
}

const keys = {
  code: (aud, target) => `otp:code:${aud}:${target}`,
  cooldown: (aud, target) => `otp:cooldown:${aud}:${target}`,
  lock: (aud, target) => `otp:lock:${aud}:${target}`,
  // Hourly send quota is per target across audiences, so one number/inbox can't be spammed via both portals.
  quota: (target) => `otp:quota:${target}`,
};

const hashOtp = (aud, target, otp) => hmacSha256(env.OTP_HMAC_SECRET, `${aud}:${target}:${otp}`);

/**
 * Reserves one verification attempt atomically and returns [attemptsUsed, hash], or [-1] when no code exists.
 * Counting before comparing means parallel requests can't each get a guess in before the counter moves.
 */
const RESERVE_ATTEMPT = `
if redis.call('exists', KEYS[1]) == 0 then return {-1} end
local n = redis.call('hincrby', KEYS[1], 'attempts', 1)
return {n, redis.call('hget', KEYS[1], 'hash')}`;

/** "123456" works in local development only when codes aren't really being delivered (console providers). */
const devBypass = (target, otp) =>
  env.isDevelopment && otp === '123456' && (isEmail(target) ? env.MAIL_PROVIDER === 'console' : env.SMS_PROVIDER === 'console');

function generateOtp() {
  const max = 10 ** env.OTP_LENGTH;
  return crypto.randomInt(0, max).toString().padStart(env.OTP_LENGTH, '0');
}

async function assertNotLocked(aud, target) {
  const ttl = await redis.ttl(keys.lock(aud, target));
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
   * Delivered by SMS for phones and by email for addresses.
   * For configured DUMMY_NUMBERS, accepts 123456 in all environments and skips SMS delivery.
   * @returns {{ expiresIn: number, resendIn: number }}
   */
  async send(aud, target) {
    if (isDummy(target)) {
      await redis.del(keys.lock(aud, target));
    } else {
      await assertNotLocked(aud, target);

      // SET NX claims the cooldown atomically, so parallel sends can't both slip past it.
      const claimed = await redis.set(keys.cooldown(aud, target), '1', 'EX', env.OTP_RESEND_COOLDOWN_SECONDS, 'NX');
      if (!claimed) {
        const cooldownTtl = Math.max(1, await redis.ttl(keys.cooldown(aud, target)));
        throw ApiError.tooManyRequests(`Please wait ${cooldownTtl}s before requesting a new code.`, {
          code: 'OTP_COOLDOWN',
          details: { retryAfter: cooldownTtl },
        });
      }

      const [[, sends], [, quotaTtl]] = await redis.multi().incr(keys.quota(target)).ttl(keys.quota(target)).exec();
      // Also repairs a counter left without an expiry, which would otherwise block the number for good.
      if (quotaTtl < 0) await redis.expire(keys.quota(target), 3600);
      if (sends > env.OTP_MAX_SENDS_PER_HOUR) {
        const ttl = await redis.ttl(keys.quota(target));
        throw ApiError.tooManyRequests(
          `Too many codes requested for this ${isEmail(target) ? 'email' : 'number'}. Please try again later.`,
          {
            code: 'OTP_QUOTA_EXCEEDED',
            details: { retryAfter: ttl },
          },
        );
      }
    }

    const otp = isDummy(target) ? '123456' : generateOtp();
    await redis
      .multi()
      .hset(keys.code(aud, target), { hash: hashOtp(aud, target, otp), attempts: 0 })
      .expire(keys.code(aud, target), env.OTP_TTL_SECONDS)
      .set(keys.cooldown(aud, target), '1', 'EX', isDummy(target) ? 1 : env.OTP_RESEND_COOLDOWN_SECONDS)
      .exec();

    if (!isDummy(target)) {
      try {
        await deliver(target, otp);
      } catch (err) {
        // Let the user retry immediately if the gateway failed; don't burn their quota either.
        await redis.multi().del(keys.code(aud, target), keys.cooldown(aud, target)).decr(keys.quota(target)).exec();
        throw err;
      }
    }

    return {
      expiresIn: env.OTP_TTL_SECONDS,
      resendIn: isDummy(target) ? 0 : env.OTP_RESEND_COOLDOWN_SECONDS,
    };
  },

  /** Verifies and consumes an OTP. Throws on mismatch/expiry. */
  async verify(aud, target, otp) {
    if (isDummy(target)) {
      await redis.del(keys.lock(aud, target));
      if (otp === '123456') {
        await redis.del(keys.code(aud, target));
        return true;
      }
      throw ApiError.badRequest('Incorrect code. Please enter 123456.', {
        code: 'OTP_INVALID',
        details: { remainingAttempts: 5 },
      });
    }

    await assertNotLocked(aud, target);

    const key = keys.code(aud, target);
    const expired = () => ApiError.badRequest('This code has expired. Please request a new one.', { code: 'OTP_EXPIRED' });
    const [attempts, hash] = await redis.eval(RESERVE_ATTEMPT, 1, key);
    if (attempts === -1 || !hash) throw expired();

    if (attempts <= env.OTP_MAX_ATTEMPTS && (safeEqual(hash, hashOtp(aud, target, otp)) || devBypass(target, otp))) {
      // Single use: if a concurrent request consumed it first, this one doesn't get a second session.
      if (!(await redis.del(key))) throw expired();
      return true;
    }

    const remaining = env.OTP_MAX_ATTEMPTS - attempts;
    if (remaining <= 0) {
      await redis
        .multi()
        .del(key)
        .set(keys.lock(aud, target), '1', 'EX', env.OTP_LOCK_MINUTES * 60)
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
