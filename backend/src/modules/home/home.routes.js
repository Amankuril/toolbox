import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { settingsService } from '#services/settings/settings.service.js';
import { buildHomePage } from './home.service.js';

/** GET /public/home: the sections below the hero. Shuffled per visit, so never shared-cached. */
export const publicHomeRoutes = Router().get('/', async (_req, res) => {
  res.set('Cache-Control', 'private, no-store');
  ok(res, await buildHomePage());
});

/** /admin/home-sections: part of the Banners section (the home page's content). */
export const adminHomeRoutes = Router()
  .get('/', async (_req, res) => ok(res, await settingsService.get('homepage')))
  .put('/', validate({ body: z.object({ sections: z.array(z.record(z.string(), z.unknown())) }) }), async (req, res) => {
    // The settings schema does the real validation (and replaces the whole list).
    ok(res, await settingsService.update('homepage', { sections: req.body.sections }, actorOf(req)));
  });
