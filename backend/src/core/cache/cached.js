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

/** Clears a cache on every running API instance; for scripts that write to the database directly. */
export async function invalidateCache(name) {
  await redis.publish(INVALIDATE_CHANNEL, name);
}

export async function listenForCacheInvalidation() {
  await redisSubscriber.subscribe(INVALIDATE_CHANNEL);
  redisSubscriber.on('message', (ch, name) => {
    if (ch === INVALIDATE_CHANNEL) registry.get(name)?.clear();
  });
}

/**
 * Shared (Redis) cache for computed read results, e.g. public listings that are already served with
 * a matching HTTP max-age, so caching them here adds no staleness clients don't already accept.
 * Falls back to the loader if Redis is unavailable; a cache must never take a read path down.
 *
 * @template T
 * @param {string} key
 * @param {number} ttlSeconds
 * @param {() => Promise<T>} loader
 * @returns {Promise<T>}
 */
export async function remember(key, ttlSeconds, loader) {
  const cacheKey = `cache:${key}`;
  const hit = await redis.get(cacheKey).catch(() => null);
  if (hit) return JSON.parse(hit);
  const value = await loader();
  await redis.set(cacheKey, JSON.stringify(value), 'EX', ttlSeconds).catch((err) => logger.warn({ err, key }, 'cache write failed'));
  return value;
}

/**
 * A generation counter for a family of `remember` entries. Readers put `current()` in their cache
 * key; writers `bump()` it, which retires every entry of the family at once.
 */
export function cacheGeneration(name) {
  const key = `cache:gen:${name}`;
  return {
    async current() {
      return (await redis.get(key).catch(() => null)) ?? '0';
    },
    bump() {
      return redis.incr(key).catch((err) => logger.warn({ err, name }, 'cache generation bump failed'));
    },
  };
}

const WRITE_HOOKS = [
  'save',
  'updateOne',
  'updateMany',
  'findOneAndUpdate',
  'findOneAndDelete',
  'deleteOne',
  'deleteMany',
  'insertMany',
  'bulkWrite',
];

/** Bumps `generation` after any write through `schema`'s model. */
export function bumpOnWrite(schema, generation) {
  schema.post(WRITE_HOOKS, () => {
    generation.bump();
  });
}

/** Public catalogue reads (listings, search suggestions): change with products, sellers and categories. */
export const catalogGeneration = cacheGeneration('catalog');
