import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { created, ok } from '#core/utils/response.js';
import { idParams, nonEmpty, objectId, optionalText, pincode } from '#core/validation/common.js';
import { MAX_QUOTE_VALID_DAYS, QUOTE_STATUSES } from './quote.model.js';
import { quoteService } from './quote.service.js';

const money = z.number().int('Amount must be in paise').min(1).max(1_000_000_000);

const listQuery = z.object({
  ...paginationQuery,
  status: z.enum(QUOTE_STATUSES).optional(),
  q: z.string().trim().max(60).optional(),
});

const requestBody = z.object({
  productId: objectId,
  quantity: z.number().int().min(1).max(10_000_000),
  targetUnitPrice: money.optional(),
  requiredBy: z.coerce
    .date()
    .refine((d) => d > new Date(), 'Pick a future date')
    .optional(),
  pincode,
  note: optionalText(1000),
});

/** Mounted at /user/quotes. */
export const userQuoteRoutes = Router()
  .get('/', validate({ query: listQuery }), async (req, res) => {
    const { items, meta } = await quoteService.listForBuyer(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .post(
    '/',
    rateLimit({ keyPrefix: 'quote-request', points: 20, duration: 24 * 60 * 60, key: (req) => String(req.auth.id) }),
    validate({ body: requestBody }),
    async (req, res) => created(res, await quoteService.request(req.account, req.body)),
  )
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await quoteService.getForBuyer(req.auth.id, req.params.id)))
  .post('/:id/accept', validate({ params: idParams }), async (req, res) => ok(res, await quoteService.accept(req.account, req.params.id)))
  .post('/:id/reject', validate({ params: idParams, body: z.object({ reason: optionalText(500) }) }), async (req, res) =>
    ok(res, await quoteService.reject(req.account, req.params.id, req.body)),
  )
  .post('/:id/withdraw', validate({ params: idParams }), async (req, res) => ok(res, await quoteService.withdraw(req.account, req.params.id)));

/** Mounted at /vendor/quotes. */
export const vendorQuoteRoutes = Router()
  .get('/', validate({ query: listQuery }), async (req, res) => {
    const { items, meta } = await quoteService.listForVendor(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await quoteService.getForVendor(req.auth.id, req.params.id)))
  .post(
    '/:id/offer',
    validate({
      params: idParams,
      body: z.object({ unitPrice: money, validDays: z.number().int().min(1).max(MAX_QUOTE_VALID_DAYS), note: optionalText(1000) }),
    }),
    async (req, res) => ok(res, await quoteService.sendOffer(req.auth.id, req.params.id, req.body)),
  )
  .post('/:id/decline', validate({ params: idParams, body: z.object({ reason: nonEmpty(1000) }) }), async (req, res) =>
    ok(res, await quoteService.decline(req.auth.id, req.params.id, req.body)),
  );

/** Mounted at /admin/quotes — oversight only; vendors and buyers act on quotes. */
export const adminQuoteRoutes = Router()
  .get('/', validate({ query: listQuery.extend({ vendor: objectId.optional() }) }), async (req, res) => {
    const { items, meta } = await quoteService.listForAdmin(req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await quoteService.getForAdmin(req.params.id)));
