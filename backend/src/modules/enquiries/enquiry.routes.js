import { Router } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams, indianPhone, nonEmpty, objectId, optionalText } from '#core/validation/common.js';
import { verifyAccessToken } from '#services/token/token.service.js';
import { ENQUIRY_STATUSES } from './enquiry.model.js';
import { enquiryService } from './enquiry.service.js';

const body = z.object({
  name: nonEmpty(120),
  phone: indianPhone,
  quantity: z.number().int().min(1).max(1_000_000).default(1),
  message: optionalText(1000),
  variantId: objectId.optional(),
});

/** The signed-in buyer, if the request carries their token; guests are fine too. */
function optionalUser(req) {
  const header = req.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const claims = verifyAccessToken(header.slice(7), 'user');
    return mongoose.isValidObjectId(claims.sub) ? claims.sub : null;
  } catch {
    return null;
  }
}

/** Mounted at /public/products: "Notify me / ask about it" on an out-of-stock product. */
export const publicEnquiryRoutes = Router().post(
  '/:id/enquiries',
  rateLimit({ keyPrefix: 'enquiry', points: 10, duration: 60 * 10 }),
  validate({ params: idParams, body }),
  async (req, res) => created(res, await enquiryService.create(req.params.id, req.body, optionalUser(req))),
);

const listQuery = z.object({ ...paginationQuery, status: z.enum(ENQUIRY_STATUSES).optional(), q: z.string().trim().max(60).optional(), vendor: objectId.optional() });
const statusBody = z.object({ status: z.enum(ENQUIRY_STATUSES) });

/** Mounted at /vendor/enquiries, /admin/store/enquiries (`scope` = the seller) and /admin/enquiries (everyone's). */
export function enquiryRoutes({ scope }) {
  return Router()
    .get('/', validate({ query: listQuery }), async (req, res) => {
      const { items, meta } = await enquiryService.list({ ...req.query, ...scope(req) });
      ok(res, items, meta);
    })
    .patch('/:id', validate({ params: idParams, body: statusBody }), async (req, res) =>
      ok(res, await enquiryService.setStatus(req.params.id, req.body.status, scope(req))),
    );
}
