import { Router } from 'express';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { idParams } from '#core/validation/common.js';
import { accessOf } from '#modules/admins/permissions.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { serializeVendorLookup } from './vendor.serializer.js';
import { vendorService } from './vendor.service.js';
import {
  addressStep,
  adminListVendors,
  adminReviewVendor,
  adminSuspendVendor,
  bankStep,
  businessStep,
  documentsStep,
  storeSlugParams,
  updateProfile,
} from './vendor.validation.js';

/** Mounted at /vendor (the vendor's own account). */
export const vendorSelfRoutes = Router()
  .get('/me', async (req, res) => ok(res, await vendorService.me(req.auth.id)))
  .patch('/me', validate(updateProfile), async (req, res) => ok(res, await vendorService.updateProfile(req.auth.id, req.body)))
  .put('/onboarding/business', validate(businessStep), async (req, res) => ok(res, await vendorService.saveBusiness(req.auth.id, req.body)))
  .put('/onboarding/address', validate(addressStep), async (req, res) => ok(res, await vendorService.saveAddress(req.auth.id, req.body)))
  .put('/onboarding/bank', validate(bankStep), async (req, res) => ok(res, await vendorService.saveBank(req.auth.id, req.body)))
  .put('/onboarding/documents', validate(documentsStep), async (req, res) =>
    ok(res, await vendorService.saveDocuments(req.auth.id, req.body)),
  )
  .post('/onboarding/submit', async (req, res) => ok(res, await vendorService.submit(req.auth.id)));

/** Admins reaching these reads through another section (see routes/index.js) only get the lookup view. */
const lookupOnly = (req) => accessOf(req.account, 'vendors') === 'none';

export const adminVendorRoutes = Router()
  .get('/', validate(adminListVendors), async (req, res) => {
    const { items, meta } = await vendorService.adminList(req.query);
    ok(res, lookupOnly(req) ? items.map(serializeVendorLookup) : items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => {
    const vendor = await vendorService.adminGet(req.params.id);
    ok(res, lookupOnly(req) ? serializeVendorLookup(vendor) : vendor);
  })
  .get('/:id/bank-account', validate({ params: idParams }), async (req, res) => {
    res.set('Cache-Control', 'no-store');
    ok(res, await vendorService.adminRevealBank(req.params.id, actorOf(req)));
  })
  .post('/:id/review', validate(adminReviewVendor), async (req, res) =>
    ok(res, await vendorService.adminReview(req.params.id, req.body, actorOf(req))),
  )
  .post('/:id/suspend', validate(adminSuspendVendor), async (req, res) =>
    ok(res, await vendorService.adminSuspend(req.params.id, req.body, actorOf(req))),
  )
  .post('/:id/reinstate', validate({ params: idParams }), async (req, res) =>
    ok(res, await vendorService.adminReinstate(req.params.id, actorOf(req))),
  );

export const publicStoreRoutes = Router().get('/:slug', validate(storeSlugParams), async (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  ok(res, await vendorService.publicStore(req.params.slug));
});
