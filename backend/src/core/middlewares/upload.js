import multer from 'multer';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';

/**
 * Files are held in memory only long enough to be re-encoded; nothing untrusted touches disk.
 * The mimetype check here is a cheap early reject, the real check uses magic bytes.
 */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024,
    files: env.UPLOAD_MAX_FILES,
    fields: 10,
    parts: env.UPLOAD_MAX_FILES + 10,
  },
  fileFilter(_req, file, cb) {
    if (!file.mimetype?.startsWith('image/')) {
      cb(ApiError.badRequest('Only image files can be uploaded', { code: 'UNSUPPORTED_FILE' }));
      return;
    }
    cb(null, true);
  },
});

export const uploadImages = (field = 'files') => imageUpload.array(field, env.UPLOAD_MAX_FILES);
