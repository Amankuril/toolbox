import { logger } from '#config/logger.js';
import { redis } from '#config/redis.js';
import { orderService } from '#modules/orders/order.service.js';
import { quoteLifecycle } from '#modules/quotes/quote.lifecycle.js';

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
];

export function startJobs() {
  const timers = JOBS.map((job) => {
    const tick = async () => {
      const lockMs = Math.max(1000, job.everyMs - 1000);
      const acquired = await redis.set(`lock:job:${job.name}`, process.pid, 'PX', lockMs, 'NX').catch(() => null);
      if (!acquired) return;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'Job failed');
      }
    };
    const timer = setInterval(tick, job.everyMs);
    timer.unref();
    return timer;
  });

  return () => timers.forEach(clearInterval);
}
