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

const moduleImages = z.object({ logo: imageInput.nullable().optional(), favicon: imageInput.nullable().optional() });
const brandingImages = z
  .object({ modules: z.object({ user: moduleImages, vendor: moduleImages, admin: moduleImages }).partial().optional() })
  .loose();

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
        const { modules = {} } = brandingImages.parse(patch);
        patch = { ...patch, modules: {} };
        for (const [module, images] of Object.entries(modules)) {
          patch.modules[module] = {};
          for (const field of ['logo', 'favicon']) {
            if (images[field] === undefined) continue;
            // Settings are stored as plain JSON, so keep the media id as a string.
            const ref = images[field] ? await mediaService.resolveOne(images[field], actor) : null;
            patch.modules[module][field] = ref && { media: String(ref.media), url: ref.url };
          }
        }
      }

      await settingsService.update(req.params.key, patch, actor);
      ok(res, await settingsService.adminView());
    },
  );
