import http from 'node:http';
import { connectDatabase, disconnectDatabase } from '#config/db.js';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { connectRedis, disconnectRedis } from '#config/redis.js';
import { listenForCacheInvalidation } from '#core/cache/cached.js';
import { createApp } from './app.js';
import { startJobs } from './jobs/index.js';

const SHUTDOWN_TIMEOUT_MS = 15_000;

async function main() {
  await Promise.all([connectDatabase(), connectRedis()]);
  await listenForCacheInvalidation();

  const server = http.createServer(createApp());
  // Must exceed nginx's upstream keepalive_timeout so nginx closes idle connections first.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 66_000;
  server.requestTimeout = 60_000;

  await new Promise((resolve) => server.listen(env.PORT, resolve));
  logger.info({ port: env.PORT, env: env.NODE_ENV }, 'API listening');

  const stopJobs = startJobs();
  // PM2 wait_ready: only route traffic once connections are up.
  process.send?.('ready');

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    force.unref();

    stopJobs();
    await new Promise((resolve) => server.close(resolve));
    await Promise.allSettled([disconnectDatabase(), disconnectRedis()]);
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

process.on('unhandledRejection', (err) => logger.error({ err }, 'Unhandled promise rejection'));
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start');
  process.exit(1);
});
