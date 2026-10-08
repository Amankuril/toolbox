import { Router } from 'express';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { idParams } from '#core/validation/common.js';
import { requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { createCoupon, listCoupons, updateCoupon } from './coupon.validation.js';
import { couponService } from './coupon.service.js';

/** Mounted at /vendor/coupons and /admin/store/coupons. */
export const vendorCouponRoutes = Router()
  .get('/', validate(listCoupons), async (req, res) => {
    const { items, meta } = await couponService.list(req.auth.id, req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await couponService.get(req.auth.id, req.params.id)))
  .post('/', requireApprovedVendor, validate(createCoupon), async (req, res) =>
    created(res, await couponService.create(req.auth.id, req.body)),
  )
  .patch('/:id', requireApprovedVendor, validate(updateCoupon), async (req, res) =>
    ok(res, await couponService.update(req.auth.id, req.params.id, req.body)),
  )
  .delete('/:id', validate({ params: idParams }), async (req, res) => ok(res, await couponService.remove(req.auth.id, req.params.id)));
