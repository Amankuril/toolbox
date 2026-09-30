import { logger } from '#config/logger.js';
import { channel, redis, redisSubscriber } from '#config/redis.js';

const INVALIDATE_CHANNEL = channel('cache:invalidate');
const registry = new Map();

/**
 * In-process cache for small, hot, rarely-changing values (settings, category tree).
 * `invalidate()` clears it on every instance of the API via Redis pub/sub.
 *
 * @template T
 * @param {string} name unique cache name
 * @param {() => Promise<T>} loader
 * @param {number} ttlMs safety TTL in case an invalidation message is missed
 */
export function cached(name, loader, ttlMs = 60_000) {
  let entry = null;
  let inflight = null;

  const api = {
    /** @returns {Promise<T>} */
    async get() {
      if (entry && Date.now() - entry.at < ttlMs) return entry.value;
      inflight ??= loader()
        .then((value) => {
          entry = { value, at: Date.now() };
          return value;
        })
        .finally(() => {
          inflight = null;
        });
      return inflight;
    },
    clear() {
      entry = null;
    },
    async invalidate() {
      entry = null;
      await redis.publish(INVALIDATE_CHANNEL, name).catch((err) => logger.warn({ err, name }, 'cache invalidate publish failed'));
    },
  };

  registry.set(name, api);
  return api;
}

export async function listenForCacheInvalidation() {
  await redisSubscriber.subscribe(INVALIDATE_CHANNEL);
  redisSubscriber.on('message', (ch, name) => {
    if (ch === INVALIDATE_CHANNEL) registry.get(name)?.clear();
  });
}
