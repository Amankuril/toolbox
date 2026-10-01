import { Router } from 'express';
import { z } from 'zod';
import { cached } from '#core/cache/cached.js';
import { ApiError } from '#core/errors/ApiError.js';
import { validate } from '#core/middlewares/validate.js';
import { created, noContent, ok } from '#core/utils/response.js';
import { idParams, imageInput, nonEmpty, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
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
  image: imageInput,
  mobileImage: imageInput.nullable().optional(),
  placement: z.enum(BANNER_PLACEMENTS),
  sortOrder: z.number().int().min(-1000).max(1000).optional(),
  status: z.enum(BANNER_STATUSES).optional(),
  startsAt: z.coerce.date().nullable().optional(),
  endsAt: z.coerce.date().nullable().optional(),
};

const activeBanners = cached(
  'banners',
  () => Banner.find({ status: 'active' }).sort({ placement: 1, sortOrder: 1, createdAt: -1 }).lean(),
  5 * 60_000,
);

async function resolveImages(input, actor) {
  const out = { ...input };
  if (input.image) out.image = await mediaService.resolveOne(input.image, actor);
  if (input.mobileImage !== undefined)
    out.mobileImage = input.mobileImage ? await mediaService.resolveOne(input.mobileImage, actor) : undefined;
  return out;
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
    ok(res, rows);
  },
);

export const adminBannerRoutes = Router()
  .get('/', async (_req, res) => ok(res, await Banner.find().sort({ placement: 1, sortOrder: 1, createdAt: -1 }).lean()))
  .post('/', validate({ body: z.object(bannerFields) }), async (req, res) => {
    const banner = await Banner.create(await resolveImages(req.body, actorOf(req)));
    await activeBanners.invalidate();
    created(res, banner.toObject());
  })
  .patch('/:id', validate({ params: idParams, body: z.object(bannerFields).partial() }), async (req, res) => {
    const banner = await Banner.findByIdAndUpdate(req.params.id, await resolveImages(req.body, actorOf(req)), {
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
