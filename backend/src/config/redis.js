import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from './logger.js';

function createClient(name) {
  const client = new Redis(env.REDIS_URL, {
    keyPrefix: env.REDIS_KEY_PREFIX,
    maxRetriesPerRequest: 3,
    enableOfflineQueue: true,
    lazyConnect: true,
    connectionName: `toolbox-${name}`,
  });
  client.on('error', (err) => logger.error({ err, client: name }, 'Redis error'));
  return client;
}

/** Main client for commands (OTP, rate limits, cache). */
export const redis = createClient('main');

/** Dedicated connection for pub/sub; a subscribed connection cannot run other commands. */
export const redisSubscriber = createClient('subscriber');

export async function connectRedis() {
  await Promise.all([redis.connect(), redisSubscriber.connect()]);
  logger.info('Redis connected');
}

export async function disconnectRedis() {
  await Promise.allSettled([redis.quit(), redisSubscriber.quit()]);
}

export function isRedisReady() {
  return redis.status === 'ready';
}

/** Pub/sub channels ignore keyPrefix, so prefix them ourselves to avoid cross-app collisions. */
export const channel = (name) => `${env.REDIS_KEY_PREFIX}${name}`;
