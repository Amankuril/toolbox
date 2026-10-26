import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { nonEmpty, optionalText } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { MAX_PAGE_LENGTH, PAGE_KEYS } from './page.model.js';
import { pageService } from './page.service.js';

const keyParams = z.object({ key: z.enum(PAGE_KEYS) });

/** Mounted at /public/pages. */
export const publicPageRoutes = Router()
  .get('/', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    ok(res, await pageService.publicList());
  })
  .get('/:slug', validate({ params: z.object({ slug: z.string().trim().max(80) }) }), async (req, res) => {
    res.set('Cache-Control', 'public, max-age=300');
    ok(res, await pageService.publicGet(req.params.slug.toLowerCase()));
  });

/** Mounted at /admin/pages. */
export const adminPageRoutes = Router()
  .get('/', async (_req, res) => ok(res, await pageService.list()))
  .put(
    '/:key',
    validate({
      params: keyParams,
      body: z.object({
        title: nonEmpty(120),
        content: z.string().trim().max(MAX_PAGE_LENGTH),
        published: z.boolean(),
        seo: z.object({ title: optionalText(160), description: optionalText(320) }).optional(),
      }),
    }),
    async (req, res) => ok(res, await pageService.update(req.params.key, req.body, actorOf(req))),
  )
  .delete('/:key', validate({ params: keyParams }), async (req, res) => ok(res, await pageService.reset(req.params.key)));
