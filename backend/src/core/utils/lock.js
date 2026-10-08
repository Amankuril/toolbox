import crypto from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { redis } from '#config/redis.js';
import { ApiError } from '#core/errors/ApiError.js';

// Deletes the lock only if we still own it, so an expired lock taken over by someone else is never released by us.
const RELEASE = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end`;

/**
 * Runs `fn` while holding a Redis mutex shared by every API instance.
 * Used to serialise read-modify-write flows that also call external services (refunds,
 * stock re-reservation), where a database-level conditional update alone isn't enough.
 *
 * @template T
 * @param {string} name lock name, e.g. `order:<id>`
 * @param {() => Promise<T>} fn
 * @param {{ ttlMs?: number, waitMs?: number, message?: string, code?: string }} [opts]
 *   ttlMs: safety expiry if the process dies mid-flight; waitMs: how long to wait for a busy lock before a 409.
 * @returns {Promise<T>}
 */
export async function withLock(
  name,
  fn,
  { ttlMs = 60_000, waitMs = 0, message = 'This is already being processed. Please try again.', code = 'BUSY' } = {},
) {
  const key = `lock:${name}`;
  const token = crypto.randomUUID();
  const deadline = Date.now() + waitMs;

  for (;;) {
    if (await redis.set(key, token, 'PX', ttlMs, 'NX')) break;
    if (Date.now() >= deadline) throw ApiError.conflict(message, { code });
    await sleep(50 + Math.floor(Math.random() * 50));
  }

  try {
    return await fn();
  } finally {
    await redis.eval(RELEASE, 1, key, token).catch(() => {});
  }
}
