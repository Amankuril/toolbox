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

/**
 * One spreadsheet (.csv or .xlsx) for bulk imports. Browsers label these inconsistently
 * (Excel on Windows calls CSVs vnd.ms-excel), so the extension decides and the content is
 * verified when it's read.
 */
const SHEET_TYPES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
  'application/x-zip-compressed',
  'application/octet-stream',
]);
const sheetUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, parts: 6 },
  fileFilter(_req, file, cb) {
    if (!/\.(csv|xlsx)$/i.test(file.originalname ?? '') || !SHEET_TYPES.has(file.mimetype)) {
      cb(
        ApiError.badRequest('Upload an Excel (.xlsx) or CSV file. Old .xls files: open in Excel and save as .xlsx.', {
          code: 'UNSUPPORTED_FILE',
        }),
      );
      return;
    }
    cb(null, true);
  },
});

export const uploadSheet = (field = 'file') => sheetUpload.single(field);
