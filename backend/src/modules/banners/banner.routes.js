import { Router } from 'express';
import { z } from 'zod';
import { cached } from '#core/cache/cached.js';
import { ApiError } from '#core/errors/ApiError.js';
import { validate } from '#core/middlewares/validate.js';
import { created, noContent, ok } from '#core/utils/response.js';
import { idParams, imageInput, nonEmpty, objectId, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { Coupon } from '#modules/coupons/coupon.model.js';
import { couponService } from '#modules/coupons/coupon.service.js';
import { mediaService } from '#modules/media/media.service.js';
import { BANNER_PLACEMENTS, BANNER_STATUSES, Banner } from './banner.model.js';

// Internal paths ("/c/drills") or absolute http(s) URLs only — never javascript: etc.
const safeLink = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v === '' || /^\/(?!\/)/.test(v) || /^https?:\/\//i.test(v), 'Use a path like /c/power-tools or a full https:// URL')
  .optional();

const bannerFields = {
  title: nonEmpty(120),
  subtitle: optionalText(240),
  ctaLabel: optionalText(40),
  link: safeLink,
  image: imageInput.nullable().optional(),
  mobileImage: imageInput.nullable().optional(),
  video: z.object({ media: objectId }).nullable().optional(),
  showText: z.boolean().optional(),
  placement: z.enum(BANNER_PLACEMENTS),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  status: z.enum(BANNER_STATUSES).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
  coupon: objectId.nullable().optional(),
};

/** Exit offers show their coupon; one that can no longer be used takes its banner down with it. */
async function withCoupons(rows) {
  const ids = rows.filter((b) => b.coupon).map((b) => b.coupon);
  if (!ids.length) return rows;
  const coupons = new Map((await Coupon.find({ _id: { $in: ids } }).lean()).map((c) => [String(c._id), couponService.serializeCoupon(c)]));
  return rows
    .map((b) => {
      if (!b.coupon) return b;
      const c = coupons.get(String(b.coupon));
      if (!c || c.state !== 'live') return null;
      const { _id, code, description, type, value, maxDiscount, minOrderValue, expiresAt } = c;
      return { ...b, coupon: { _id, code, description, type, value, maxDiscount, minOrderValue, expiresAt } };
    })
    .filter(Boolean);
}

const activeBanners = cached(
  'banners',
  () => Banner.find({ status: 'active' }).sort({ placement: 1, sortOrder: 1, createdAt: -1 }).lean(),
  5 * 60_000,
);

/** Every placement needs a picture; the hero can have a video instead (or as well). */
function assertMedia({ placement, image, video }) {
  if (image) return;
  if (placement === 'home_hero' && video) return;
  throw ApiError.unprocessable(placement === 'home_hero' ? 'Add an image or a video' : 'Upload an image', {
    code: 'BANNER_MEDIA_REQUIRED',
    details: [{ path: 'image', message: placement === 'home_hero' ? 'Add an image or a video' : 'Upload an image' }],
  });
}

/** Resolves media refs; cleared fields (null) are collected for $unset rather than stored as null. */
async function resolveImages(input, actor) {
  const { coupon, ...out } = input;
  const unset = {};
  if (coupon) out.coupon = coupon;
  for (const field of ['image', 'mobileImage']) {
    if (input[field] === undefined) continue;
    if (input[field]) out[field] = await mediaService.resolveOne(input[field], actor);
    else {
      delete out[field];
      unset[field] = 1;
    }
  }
  if (input.video !== undefined) {
    if (input.video) [out.video] = await mediaService.resolve([input.video], actor, { type: 'video' });
    else {
      delete out.video;
      unset.video = 1;
    }
  }
  return { fields: out, unset };
}

export const publicBannerRoutes = Router().get(
  '/',
  validate({ query: z.object({ placement: z.enum(BANNER_PLACEMENTS).optional() }) }),
  async (req, res) => {
    const now = Date.now();
    const rows = (await activeBanners.get()).filter(
      (b) =>
        (!req.query.placement || b.placement === req.query.placement) &&
        (!b.startsAt || new Date(b.startsAt).getTime() <= now) &&
        (!b.endsAt || new Date(b.endsAt).getTime() > now),
    );
    res.set('Cache-Control', 'public, max-age=60');
    ok(res, await withCoupons(rows));
  },
);

export const adminBannerRoutes = Router()
  .get('/', async (_req, res) =>
    ok(res, await Banner.find().sort({ placement: 1, sortOrder: 1, createdAt: -1 }).populate('coupon', 'code type value active expiresAt').lean()),
  )
  .post('/', validate({ body: z.object(bannerFields) }), async (req, res) => {
    const { fields } = await resolveImages(req.body, actorOf(req));
    if (fields.placement !== 'home_hero') delete fields.video;
    assertMedia(fields);
    const banner = await Banner.create(fields);
    await activeBanners.invalidate();
    created(res, banner.toObject());
  })
  .patch('/:id', validate({ params: idParams, body: z.object(bannerFields).partial() }), async (req, res) => {
    const current = await Banner.findById(req.params.id).lean();
    if (!current) throw ApiError.notFound('Banner not found');
    const { fields, unset } = await resolveImages(req.body, actorOf(req));
    // A cleared coupon is removed rather than stored as null.
    if (req.body.coupon === null) unset.coupon = 1;
    // Only the hero plays video.
    if ((fields.placement ?? current.placement) !== 'home_hero') {
      delete fields.video;
      unset.video = 1;
    }
    const next = { ...current, ...fields };
    for (const k of Object.keys(unset)) delete next[k];
    assertMedia(next);
    const update = Object.keys(unset).length ? { $set: fields, $unset: unset } : fields;
    const banner = await Banner.findByIdAndUpdate(req.params.id, update, {
      returnDocument: 'after',
      runValidators: true,
    }).lean();
    if (!banner) throw ApiError.notFound('Banner not found');
    await activeBanners.invalidate();
    ok(res, banner);
  })
  .delete('/:id', validate({ params: idParams }), async (req, res) => {
    const result = await Banner.deleteOne({ _id: req.params.id });
    if (!result.deletedCount) throw ApiError.notFound('Banner not found');
    await activeBanners.invalidate();
    noContent(res);
  });
