import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams, objectId, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { User } from '#modules/users/user.model.js';
import { ApiError } from '#core/errors/ApiError.js';
import { MAX_TOPUP, MIN_TOPUP, walletService } from './wallet.service.js';

const historyQuery = z.object(paginationQuery);
const amount = z.number().int().min(100).max(MAX_TOPUP);

/** Mounted at /user/wallet. */
export const userWalletRoutes = Router()
  .get('/', validate({ query: historyQuery }), async (req, res) => {
    const { items, meta } = await walletService.history(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .post('/topup', validate({ body: z.object({ amount: z.number().int().min(MIN_TOPUP).max(MAX_TOPUP) }) }), async (req, res) =>
    ok(res, await walletService.startTopup(req.account, req.body.amount)),
  )
  .post(
    '/topup/verify',
    validate({
      body: z.object({
        providerOrderId: z.string().trim().min(1).max(100),
        paymentId: z.string().trim().min(1).max(100),
        signature: z.string().trim().min(1).max(200),
      }),
    }),
    async (req, res) => ok(res, await walletService.verifyTopup(req.account, req.body)),
  );

const adjustBody = z.object({ type: z.enum(['credit', 'debit']), amount, note: optionalText(300) });

/** Mounted at /admin/wallets: a customer's balance and history, and manual credits or debits. */
export const adminWalletRoutes = Router()
  .get('/:id', validate({ params: idParams, query: historyQuery }), async (req, res) => {
    const { items, meta } = await walletService.history(req.params.id, req.query);
    ok(res, items, meta);
  })
  .post('/:id', validate({ params: idParams, body: adjustBody }), async (req, res) => {
    if (!(await User.exists({ _id: req.params.id }))) throw ApiError.notFound('Customer not found');
    const { type, amount: value, note } = req.body;
    const by = actorOf(req);
    const txn =
      type === 'credit'
        ? await walletService.credit(req.params.id, value, { reason: 'admin_credit', note, by })
        : await walletService.debit(req.params.id, value, { reason: 'admin_debit', note, by });
    ok(res, { txn, balance: await walletService.balance(req.params.id) });
  })
  // The same credit for several customers at once (e.g. a goodwill credit from the customer list).
  .post('/', validate({ body: z.object({ userIds: z.array(objectId).min(1).max(500), amount, note: optionalText(300) }) }), async (req, res) => {
    const by = actorOf(req);
    const users = await User.find({ _id: { $in: req.body.userIds } }).select('_id').lean();
    for (const u of users) await walletService.credit(u._id, req.body.amount, { reason: 'admin_credit', note: req.body.note, by });
    ok(res, { credited: users.length });
  });
