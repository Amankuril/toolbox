import { RateLimiterMemory, RateLimiterRedis } from 'rate-limiter-flexible';
import { env } from '#config/env.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#core/errors/ApiError.js';

/**
 * Creates a Redis-backed limiter (shared across PM2 instances).
 * Falls back to memory in tests so suites don't leak state into each other.
 */
export function createLimiter({ keyPrefix, points, duration, blockDuration = 0 }) {
  const opts = { keyPrefix: `rl:${keyPrefix}`, points, duration, blockDuration };
  return env.isTest ? new RateLimiterMemory(opts) : new RateLimiterRedis({ ...opts, storeClient: redis, rejectIfRedisNotReady: false });
}

/**
 * Express middleware wrapper.
 * @param {{ keyPrefix: string, points: number, duration: number, blockDuration?: number, key?: (req) => string, message?: string }} options
 */
export function rateLimit({ key = (req) => req.ip, message, ...limiterOpts }) {
  const limiter = createLimiter(limiterOpts);
  return async (req, res, next) => {
    try {
      const result = await limiter.consume(key(req));
      res.setHeader('RateLimit-Remaining', String(result.remainingPoints));
      next();
    } catch (rejection) {
      if (rejection instanceof Error) return next(rejection);
      const retryAfter = Math.ceil(rejection.msBeforeNext / 1000);
      next(ApiError.tooManyRequests(message, { details: { retryAfter } }));
    }
  };
}

/** Consume a point outside of middleware (e.g. inside a service). Throws 429 when exhausted. */
export async function consumeOrThrow(limiter, key, message) {
  try {
    await limiter.consume(key);
  } catch (rejection) {
    if (rejection instanceof Error) throw rejection;
    throw ApiError.tooManyRequests(message, { details: { retryAfter: Math.ceil(rejection.msBeforeNext / 1000) } });
  }
}
