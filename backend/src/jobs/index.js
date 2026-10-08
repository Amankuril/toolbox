import crypto from 'node:crypto';
import { logger } from '#config/logger.js';
import { redis } from '#config/redis.js';
import { orderService } from '#modules/orders/order.service.js';
import { productImportService } from '#modules/products/imports/import.service.js';
import { quoteLifecycle } from '#modules/quotes/quote.lifecycle.js';
import { shippingService } from '#modules/shipping/shipping.service.js';

/**
 * Lightweight interval jobs. A Redis lock makes sure only one API instance in the
 * PM2 cluster runs each tick.
 */
const JOBS = [
  {
    name: 'expire-unpaid-orders',
    everyMs: 60_000,
    async run() {
      const expired = await orderService.expireUnpaid();
      if (expired) logger.info({ expired }, 'Expired unpaid orders');
    },
  },
  {
    name: 'expire-stale-quotes',
    everyMs: 5 * 60_000,
    async run() {
      const expired = await quoteLifecycle.expireStale();
      if (expired) logger.info({ expired }, 'Expired lapsed quotes');
    },
  },
  {
    name: 'reconcile-pending-payments',
    everyMs: 3 * 60_000,
    async run() {
      const reconciled = await orderService.reconcilePendingPayments();
      if (reconciled) logger.info({ reconciled }, 'Reconciled pending payments with gateway');
    },
  },
  {
    name: 'auto-create-shipments',
    everyMs: 2 * 60_000,
    async run() {
      const pushed = await shippingService.autoCreate();
      if (pushed) logger.info({ pushed }, 'Pushed shipments to the shipping provider');
    },
  },
  {
    name: 'process-product-imports',
    everyMs: 10_000,
    async run() {
      // Budget below the tick so the Redis lock never outlives the run; leases make overlap harmless anyway.
      const processed = await productImportService.processQueued({ budgetMs: 8_000 });
      if (processed) logger.info({ processed }, 'Processed product import items');
    },
  },
  {
    name: 'purge-product-imports',
    everyMs: 60 * 60_000,
    async run() {
      const purged = await productImportService.purge();
      if (purged) logger.info({ purged }, 'Purged old product imports');
    },
  },
  {
    name: 'sync-shipment-tracking',
    everyMs: 10 * 60_000,
    async run() {
      const synced = await shippingService.syncTracking();
      if (synced) logger.info({ synced }, 'Synced shipment tracking');
    },
  },
];

// Extends the lock only while we still own it.
const EXTEND = `if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end`;

export function startJobs() {
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      // A run that outlasts its interval must not overlap with itself on this instance...
      if (running) return;
      const key = `lock:job:${job.name}`;
      const token = `${process.pid}:${crypto.randomUUID()}`;
      const lockMs = Math.max(1000, job.everyMs - 1000);
      const acquired = await redis.set(key, token, 'PX', lockMs, 'NX').catch(() => null);
      if (!acquired) return;
      running = true;
      // ...or with another instance once the lock would have expired.
      const heartbeat = setInterval(() => redis.eval(EXTEND, 1, key, token, lockMs).catch(() => {}), Math.max(500, lockMs / 2));
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'Job failed');
      } finally {
        clearInterval(heartbeat);
        running = false;
      }
    };
    const timer = setInterval(tick, job.everyMs);
    timer.unref();
    return timer;
  });

  return () => timers.forEach(clearInterval);
}
