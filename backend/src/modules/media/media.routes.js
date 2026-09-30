import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { uploadImages } from '#core/middlewares/upload.js';
import { validate } from '#core/middlewares/validate.js';
import { created, noContent, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams } from '#core/validation/common.js';
import { actorOf } from '#modules/auth/auth.middleware.js';
import { MEDIA_FOLDERS } from './media.model.js';
import { mediaService } from './media.service.js';

const uploadQuery = { query: z.object({ folder: z.enum(MEDIA_FOLDERS) }) };

/**
 * POST /media?folder=products  (multipart, field "files")
 * Mounted under each authenticated audience router.
 */
export function mediaUploadRouter() {
  const router = Router();
  const limit = rateLimit({ keyPrefix: 'media-upload', points: 60, duration: 10 * 60, key: (req) => `${req.auth.audience}:${req.auth.id}` });

  router.post('/', limit, uploadImages('files'), validate(uploadQuery), async (req, res) => {
    created(res, await mediaService.upload(req.files, { folder: req.query.folder, actor: actorOf(req) }));
  });

  return router;
}

/** Admin media library. */
export function adminMediaRouter() {
  const router = mediaUploadRouter();

  router.get(
    '/',
    validate({ query: z.object({ ...paginationQuery, folder: z.enum(MEDIA_FOLDERS).optional(), provider: z.enum(['local', 'cloudinary']).optional() }) }),
    async (req, res) => {
      const { items, meta } = await mediaService.list(req.query);
      ok(res, items, meta);
    },
  );

  router.delete('/:id', validate({ params: idParams }), async (req, res) => {
    await mediaService.remove(req.params.id);
    noContent(res);
  });

  return router;
}
