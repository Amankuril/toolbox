import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { imageInput } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { mediaService } from '#modules/media/media.service.js';
import { settingsService } from '#services/settings/settings.service.js';
import { SETTING_KEYS } from './settings.schema.js';

export const publicSettingsRoutes = Router().get('/', async (_req, res) => {
  res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=600');
  ok(res, await settingsService.publicView());
});

const brandingImages = z.object({ logo: imageInput.nullable().optional(), favicon: imageInput.nullable().optional() }).loose();

/** Mounted at /admin/settings. */
export const adminSettingsRoutes = Router()
  .get('/', async (_req, res) => ok(res, await settingsService.adminView()))
  .put(
    '/:key',
    validate({ params: z.object({ key: z.enum(SETTING_KEYS) }), body: z.record(z.string(), z.unknown()) }),
    async (req, res) => {
      const actor = actorOf(req);
      let patch = req.body;

      // Image refs are resolved server-side so a URL can never be injected into branding.
      if (req.params.key === 'branding') {
        const images = brandingImages.parse(patch);
        patch = { ...patch };
        for (const field of ['logo', 'favicon']) {
          if (images[field] !== undefined) patch[field] = images[field] ? await mediaService.resolveOne(images[field], actor) : null;
        }
      }

      await settingsService.update(req.params.key, patch, actor);
      ok(res, await settingsService.adminView());
    },
  );
