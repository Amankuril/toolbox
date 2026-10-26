import { Router } from 'express';
import { z } from 'zod';
import { env } from '#config/env.js';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { idParams, objectId } from '#core/validation/common.js';
import { actorOf, requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { leadMessages } from '#modules/leads/leads.service.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { createCoupon, listCoupons, updateCoupon } from './coupon.validation.js';
import { couponService } from './coupon.service.js';

const shareBody = z.object({ userIds: z.array(objectId).min(1).max(500) });
const appUrl = (path) => `${env.PUBLIC_APP_URL.replace(/\/+$/, '')}${path}`;

/** Who a shared coupon is from, and where its link goes: the seller's store page, or the storefront for platform coupons. */
async function sender(vendorId) {
  if (!vendorId) return { from: (await settingsService.get('branding')).siteName, link: appUrl('/account/coupons') };
  const v = await Vendor.findById(vendorId).select('store.name store.slug').lean();
  return { from: v?.store?.name ?? 'us', link: v?.store?.slug ? appUrl(`/store/${v.store.slug}`) : appUrl('/') };
}

/**
 * Coupon management for one owner. `scope(req)` is the seller id, or null for platform coupons (admins).
 * Sellers must be approved to create or change coupons.
 */
export function couponRoutes({ scope = (req) => req.auth.id, guard = requireApprovedVendor } = {}) {
  return Router()
    .get('/', validate(listCoupons), async (req, res) => {
      const { items, meta } = await couponService.list(scope(req), req.query);
      ok(res, items, meta);
    })
    .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await couponService.get(scope(req), req.params.id)))
    .post('/', guard, validate(createCoupon), async (req, res) => created(res, await couponService.create(scope(req), req.body)))
    .patch('/:id', guard, validate(updateCoupon), async (req, res) => ok(res, await couponService.update(scope(req), req.params.id, req.body)))
    .delete('/:id', validate({ params: idParams }), async (req, res) => ok(res, await couponService.remove(scope(req), req.params.id)))
    // Share coupon: send it to chosen customers (My coupons) and get a WhatsApp message to tell each one.
    .post('/:id/share', guard, validate({ params: idParams, body: shareBody }), async (req, res) => {
      const vendorId = scope(req);
      ok(res, await couponService.share(vendorId, req.params.id, req.body.userIds, actorOf(req), { ...(await sender(vendorId)), message: leadMessages.offer }));
    });
}

/** Mounted at /vendor/coupons and /admin/store/coupons. */
export const vendorCouponRoutes = couponRoutes();

/** Mounted at /admin/coupons: platform coupons, good on every seller's products. */
export const adminCouponRoutes = couponRoutes({ scope: () => null, guard: (_req, _res, next) => next() });

/** Mounted at /user/coupons: coupons sent to this buyer. */
export const userCouponRoutes = Router()
  .get('/', async (req, res) => ok(res, await couponService.forUser(req.auth.id)))
  .get('/unseen', async (req, res) => ok(res, { count: await couponService.unseenCount(req.auth.id) }));
