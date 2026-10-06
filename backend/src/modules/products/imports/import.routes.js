import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '#core/errors/ApiError.js';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { uploadCsv } from '#core/middlewares/upload.js';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams } from '#core/validation/common.js';
import { requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { IMPORT_MODES } from './import.model.js';
import { productImportService } from './import.service.js';

const sendCsv = (res, name, body) =>
  res
    .status(200)
    .type('text/csv; charset=utf-8')
    .set('Content-Disposition', `attachment; filename="${name}"`)
    .set('Cache-Control', 'private, no-store')
    .send(body);

const uploadLimit = rateLimit({ keyPrefix: 'product-import', points: 20, duration: 60 * 60, key: (req) => String(req.auth.id) });

/** Mounted at /vendor/product-imports. */
export const vendorProductImportRoutes = Router()
  .get('/template.csv', (_req, res) => sendCsv(res, 'products-template.csv', productImportService.template()))
  .get('/columns', (_req, res) => ok(res, productImportService.columns()))
  .get('/categories.csv', async (req, res) => sendCsv(res, 'categories.csv', await productImportService.categoriesCsv(req.account)))
  .get('/export.csv', async (req, res) =>
    sendCsv(res, `products-${new Date().toISOString().slice(0, 10)}.csv`, await productImportService.exportCsv(req.account)),
  )
  .get('/', validate({ query: z.object(paginationQuery) }), async (req, res) => {
    const { items, meta } = await productImportService.list(req.account, req.query);
    ok(res, items, meta);
  })
  .post(
    '/',
    requireApprovedVendor,
    uploadLimit,
    uploadCsv('file'),
    validate({ body: z.object({ mode: z.enum(IMPORT_MODES).default('create') }) }),
    async (req, res) => {
      if (!req.file?.buffer?.length) throw ApiError.badRequest('Choose a CSV file to upload', { code: 'NO_FILE' });
      // A CSV is text; NUL bytes mean a binary file (e.g. .xlsx renamed to .csv).
      if (req.file.buffer.includes(0))
        throw ApiError.badRequest('This is not a CSV file. Save the sheet as CSV and try again.', { code: 'UNSUPPORTED_FILE' });
      created(res, await productImportService.create(req.account, req.file, req.body.mode));
    },
  )
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await productImportService.get(req.account, req.params.id)))
  .get(
    '/:id/items',
    validate({
      params: idParams,
      query: z.object({
        ...paginationQuery,
        status: z.enum(['problems', 'pending', 'created', 'updated', 'failed', 'invalid', 'skipped']).optional(),
      }),
    }),
    async (req, res) => {
      const { items, meta } = await productImportService.items(req.account, req.params.id, req.query);
      ok(res, items, meta);
    },
  )
  .get('/:id/issues.csv', validate({ params: idParams }), async (req, res) =>
    sendCsv(res, 'import-problems.csv', await productImportService.issuesCsv(req.account, req.params.id)),
  )
  .post('/:id/start', requireApprovedVendor, validate({ params: idParams }), async (req, res) =>
    ok(res, await productImportService.start(req.account, req.params.id)),
  )
  .post('/:id/cancel', validate({ params: idParams }), async (req, res) =>
    ok(res, await productImportService.cancel(req.account, req.params.id)),
  );
