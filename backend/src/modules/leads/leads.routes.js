import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { ok } from '#core/utils/response.js';
import { objectId } from '#core/validation/common.js';
import { requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { CONTACT_CHANNELS } from './lead.model.js';
import { leadsService } from './leads.service.js';

const listQuery = {
  ...paginationQuery,
  q: z.string().trim().max(60).optional(),
  sort: z.enum(['newest', 'oldest']).default('newest'),
  period: z.enum(['24h', '7d', '30d']).optional(),
};
const userParams = z.object({ userId: objectId });

// Each contact opens a chat or SMS from the seller's own phone; this only stops runaway loops.
const contactLimit = rateLimit({ keyPrefix: 'lead-contact', points: 120, duration: 60 * 60, key: (req) => String(req.auth.id) });

/** Mounted at /vendor/leads and /admin/store/leads. */
export const vendorLeadRoutes = Router()
  .get('/counts', async (req, res) => ok(res, await leadsService.counts(req.auth.id)))
  .get(
    '/carts',
    validate({ query: z.object({ ...listQuery, tab: z.enum(['abandoned', 'active']).default('abandoned') }) }),
    async (req, res) => {
      const { items, meta } = await leadsService.carts(req.auth.id, req.query);
      ok(res, items, meta);
    },
  )
  .get('/whatsapp', validate({ query: z.object(listQuery) }), async (req, res) => {
    const { items, meta } = await leadsService.whatsapp(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .get('/customers/:userId', validate({ params: userParams }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    ok(res, await leadsService.customer(req.auth.id, req.params.userId));
  })
  .post(
    '/customers/:userId/contact',
    requireApprovedVendor,
    contactLimit,
    validate({ params: userParams, body: z.object({ channel: z.enum(CONTACT_CHANNELS), couponId: objectId.optional() }) }),
    async (req, res) => ok(res, await leadsService.contact(req.auth.id, req.params.userId, req.body, req.auth.actingAdmin)),
  );

const chatLimit = rateLimit({ keyPrefix: 'wa-chat', points: 30, duration: 60 * 60, key: (req) => String(req.auth.id) });

/** Mounted at /user: "Chat on WhatsApp" on a product page. */
export const userChatRoutes = Router().post(
  '/whatsapp-chat',
  chatLimit,
  validate({ body: z.object({ productId: objectId }) }),
  async (req, res) => ok(res, await leadsService.startChat(req.auth.id, req.body.productId)),
);
