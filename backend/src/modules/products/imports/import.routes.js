import { Router } from 'express';
import { z } from 'zod';
import { ApiError } from '#core/errors/ApiError.js';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { uploadSheet } from '#core/middlewares/upload.js';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams, objectId } from '#core/validation/common.js';
import { actorOf, requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { IMPORT_MODES } from './import.model.js';
import { productImportService } from './import.service.js';
import { SHEET_FORMATS } from './import.sheets.js';

const sendFile = (res, name, { body, type }) =>
  res
    .status(200)
    .type(type)
    .set('Content-Disposition', `attachment; filename="${name}"`)
    .set('Cache-Control', 'private, no-store')
    .send(body);

const today = () => new Date().toISOString().slice(0, 10);
const format = z.enum(SHEET_FORMATS).default('xlsx');
const itemsQuery = z.object({
  ...paginationQuery,
  status: z.enum(['problems', 'pending', 'created', 'updated', 'failed', 'invalid', 'skipped']).optional(),
});

/**
 * Same endpoints for vendors (their own imports) and admins (any vendor's).
 * @param {{ scope: (req) => object, vendorId: (req) => any, uploadVendor: (req) => Promise<any>, guard?: any[] }} opts
 */
function importRoutes({ scope, vendorId, uploadVendor, guard = [], uploadBody, listQuery }) {
  const uploadLimit = rateLimit({ keyPrefix: 'product-import', points: 20, duration: 60 * 60, key: (req) => String(req.auth.id) });
  return Router()
    .get('/template', validate({ query: z.object({ format, vendorId: objectId.optional() }) }), async (req, res) => {
      const file = await productImportService.template({ vendorId: vendorId(req), format: req.query.format });
      sendFile(res, `products-template.${file.ext}`, file);
    })
    .get('/columns', (_req, res) => ok(res, productImportService.columns()))
    .get('/categories.csv', validate({ query: z.object({ vendorId: objectId.optional() }) }), async (req, res) =>
      sendFile(res, 'categories.csv', { body: await productImportService.categoriesCsv(vendorId(req)), type: 'text/csv; charset=utf-8' }),
    )
    .get('/export', validate({ query: z.object({ format, vendorId: objectId.optional() }) }), async (req, res) => {
      const id = vendorId(req);
      if (!id) throw ApiError.unprocessable('Choose a vendor to export', { code: 'VENDOR_REQUIRED' });
      const file = await productImportService.exportFile(id, req.query.format);
      sendFile(res, `products-${today()}.${file.ext}`, file);
    })
    .get('/', validate({ query: listQuery }), async (req, res) => {
      const { items, meta } = await productImportService.list(scope(req), req.query);
      ok(res, items, meta);
    })
    .post('/', ...guard, uploadLimit, uploadSheet('file'), validate({ body: uploadBody }), async (req, res) => {
      if (!req.file?.buffer?.length) throw ApiError.badRequest('Choose a file to upload', { code: 'NO_FILE' });
      const vendor = await uploadVendor(req);
      created(res, await productImportService.create(vendor, req.file, req.body.mode, actorOf(req)));
    })
    .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await productImportService.get(scope(req), req.params.id)))
    .get('/:id/items', validate({ params: idParams, query: itemsQuery }), async (req, res) => {
      const { items, meta } = await productImportService.items(scope(req), req.params.id, req.query);
      ok(res, items, meta);
    })
    .get('/:id/issues.csv', validate({ params: idParams }), async (req, res) =>
      sendFile(res, 'import-problems.csv', {
        body: await productImportService.issuesCsv(scope(req), req.params.id),
        type: 'text/csv; charset=utf-8',
      }),
    )
    .post('/:id/start', ...guard, validate({ params: idParams }), async (req, res) =>
      ok(res, await productImportService.start(scope(req), req.params.id)),
    )
    .post('/:id/cancel', validate({ params: idParams }), async (req, res) =>
      ok(res, await productImportService.cancel(scope(req), req.params.id)),
    );
}

/** Mounted at /vendor/product-imports: a vendor only ever sees and writes their own. */
export const vendorProductImportRoutes = importRoutes({
  scope: (req) => ({ vendor: req.auth.id }),
  vendorId: (req) => req.auth.id,
  uploadVendor: async (req) => req.account,
  guard: [requireApprovedVendor],
  uploadBody: z.object({ mode: z.enum(IMPORT_MODES).default('create') }),
  listQuery: z.object(paginationQuery),
});

/** Mounted at /admin/product-imports: uploads go to the chosen (approved) vendor's catalogue. */
export const adminProductImportRoutes = importRoutes({
  scope: () => ({}),
  vendorId: (req) => req.query.vendorId,
  uploadVendor: async (req) => {
    const vendor = await Vendor.findById(req.body.vendorId).lean();
    if (!vendor) throw ApiError.notFound('Vendor not found');
    if (vendor.status !== 'approved')
      throw ApiError.unprocessable('Products can only be imported for approved vendors', { code: 'VENDOR_NOT_APPROVED' });
    return vendor;
  },
  uploadBody: z.object({ mode: z.enum(IMPORT_MODES).default('create'), vendorId: objectId }),
  listQuery: z.object({ ...paginationQuery, vendor: objectId.optional() }),
});
