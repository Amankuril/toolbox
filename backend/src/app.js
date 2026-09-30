import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { API_PREFIX } from '#config/constants.js';
import { isDatabaseReady } from '#config/db.js';
import { env } from '#config/env.js';
import { isRedisReady } from '#config/redis.js';
import { errorHandler, notFoundHandler } from '#core/errors/errorHandler.js';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { requestLogger } from '#core/middlewares/requestLogger.js';
import { webhookRoutes } from '#modules/orders/order.routes.js';
import { buildRoutes } from './routes/index.js';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  // Behind nginx: trust N proxy hops so req.ip / secure cookies reflect the real client.
  app.set('trust proxy', env.TRUST_PROXY);

  app.use(requestLogger);
  app.use(
    helmet({
      // JSON API: no HTML rendered here, so a locked-down CSP costs nothing.
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );
  app.use(
    cors({
      origin(origin, cb) {
        // Non-browser clients (curl, server-to-server, webhooks) send no Origin.
        cb(null, !origin || env.CORS_ORIGINS.includes(origin));
      },
      credentials: true,
      maxAge: 600,
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
    }),
  );
  app.use(compression());

  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', (_req, res) => {
    const checks = { mongo: isDatabaseReady(), redis: isRedisReady() };
    const ready = Object.values(checks).every(Boolean);
    res.status(ready ? 200 : 503).json({ status: ready ? 'ok' : 'degraded', checks });
  });

  // Webhooks need the raw body for signature checks, so they sit before the JSON parser.
  app.use(`${API_PREFIX}/webhooks`, webhookRoutes);

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(cookieParser());

  // In production nginx serves uploads straight from disk; Express only does it in dev/test.
  if (!env.isProduction) {
    app.use(
      env.LOCAL_UPLOAD_PUBLIC_PATH,
      helmet.crossOriginResourcePolicy({ policy: 'cross-origin' }),
      express.static(env.LOCAL_UPLOAD_DIR, { index: false, dotfiles: 'deny', immutable: true, maxAge: '30d', fallthrough: false }),
    );
  }

  app.use(API_PREFIX, rateLimit({ keyPrefix: 'api', points: 600, duration: 60 }), buildRoutes());

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
