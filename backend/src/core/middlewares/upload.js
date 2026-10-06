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

/** One spreadsheet (CSV) for bulk imports. Excel on Windows labels CSVs as vnd.ms-excel. */
const CSV_TYPES = new Set(['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel', 'application/octet-stream']);
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
  fileFilter(_req, file, cb) {
    if (!/\.csv$/i.test(file.originalname ?? '') || !CSV_TYPES.has(file.mimetype)) {
      cb(
        ApiError.badRequest('Upload a .csv file. In Excel or Google Sheets use File → Download / Save as → CSV.', {
          code: 'UNSUPPORTED_FILE',
        }),
      );
      return;
    }
    cb(null, true);
  },
});

export const uploadCsv = (field = 'file') => csvUpload.single(field);
