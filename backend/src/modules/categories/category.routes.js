import { Router } from 'express';
import { validate } from '#core/middlewares/validate.js';
import { created, noContent, ok } from '#core/utils/response.js';
import { idParams } from '#core/validation/common.js';
import { actorOf, requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { categoryService } from './category.service.js';
import {
  adminCreateCategory,
  adminListCategories,
  adminUpdateCategory,
  reviewCategory,
  slugParams,
  vendorCreateCategory,
  vendorUpdateCategory,
} from './category.validation.js';

export const publicCategoryRoutes = Router()
  .get('/tree', async (_req, res) => {
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    ok(res, await categoryService.tree());
  })
  .get('/:slug', validate(slugParams), async (req, res) => {
    ok(res, await categoryService.publicBySlug(req.params.slug));
  });

export const vendorCategoryRoutes = Router()
  .get('/', async (req, res) => {
    ok(res, await categoryService.listForVendor(req.auth.id));
  })
  // Proposals go into the shared public tree (immediately, with auto-approve on), so only approved sellers make them.
  .post('/', requireApprovedVendor, validate(vendorCreateCategory), async (req, res) => {
    created(res, await categoryService.create(req.body, actorOf(req)));
  })
  .patch('/:id', requireApprovedVendor, validate(vendorUpdateCategory), async (req, res) => {
    ok(res, await categoryService.update(req.params.id, req.body, actorOf(req)));
  })
  .delete('/:id', validate({ params: idParams }), async (req, res) => {
    await categoryService.remove(req.params.id, actorOf(req));
    noContent(res);
  });

export const adminCategoryRoutes = Router()
  .get('/', validate(adminListCategories), async (req, res) => {
    const { items, meta } = await categoryService.listForAdmin(req.query);
    ok(res, items, meta);
  })
  .get('/tree', async (_req, res) => {
    ok(res, await categoryService.tree());
  })
  .post('/', validate(adminCreateCategory), async (req, res) => {
    created(res, await categoryService.create(req.body, actorOf(req)));
  })
  .patch('/:id', validate(adminUpdateCategory), async (req, res) => {
    ok(res, await categoryService.update(req.params.id, req.body, actorOf(req)));
  })
  .post('/:id/review', validate(reviewCategory), async (req, res) => {
    ok(res, await categoryService.review(req.params.id, req.body, actorOf(req)));
  })
  .delete('/:id', validate({ params: idParams }), async (req, res) => {
    await categoryService.remove(req.params.id, actorOf(req));
    noContent(res);
  });
