import { Router } from 'express';
import { validate } from '#core/middlewares/validate.js';
import { created, noContent, ok } from '#core/utils/response.js';
import { idParams } from '#core/validation/common.js';
import { actorOf, requireApprovedVendor } from '#modules/auth/auth.middleware.js';
import { productService } from './product.service.js';
import {
  adminListProducts,
  adminUpdateProduct,
  productSlugParams,
  publicListProducts,
  reviewProduct,
  suggestQuery,
  vendorCreateProduct,
  vendorListProducts,
  vendorStockUpdate,
  vendorUpdateProduct,
  vendorVisibility,
} from './product.validation.js';

export const publicProductRoutes = Router()
  .get('/', validate(publicListProducts), async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const { items, meta, facets } = await productService.publicList(req.query);
    ok(res, items, { ...meta, facets });
  })
  .get('/suggest', validate(suggestQuery), async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    ok(res, await productService.suggest(req.query.q));
  })
  .get('/:slug', validate(productSlugParams), async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    ok(res, await productService.publicBySlug(req.params.slug));
  });

export const vendorProductRoutes = Router()
  .get('/', validate(vendorListProducts), async (req, res) => {
    const { items, meta } = await productService.vendorList(req.account, req.query);
    ok(res, items, meta);
  })
  .get('/compatibility-search', validate(suggestQuery), async (req, res) => {
    ok(res, await productService.compatibilityCandidates(req.query.q));
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => {
    ok(res, await productService.vendorGet(req.account, req.params.id));
  })
  .post('/', requireApprovedVendor, validate(vendorCreateProduct), async (req, res) => {
    created(res, await productService.vendorCreate(req.account, req.body));
  })
  .patch('/:id', requireApprovedVendor, validate(vendorUpdateProduct), async (req, res) => {
    ok(res, await productService.vendorUpdate(req.account, req.params.id, req.body));
  })
  .patch('/:id/stock', requireApprovedVendor, validate(vendorStockUpdate), async (req, res) => {
    ok(res, await productService.vendorQuickUpdate(req.account, req.params.id, req.body));
  })
  .patch('/:id/visibility', requireApprovedVendor, validate(vendorVisibility), async (req, res) => {
    ok(res, await productService.vendorSetVisibility(req.account, req.params.id, req.body.visible));
  })
  .delete('/:id', validate({ params: idParams }), async (req, res) => {
    await productService.vendorArchive(req.account, req.params.id);
    noContent(res);
  });

export const adminProductRoutes = Router()
  .get('/', validate(adminListProducts), async (req, res) => {
    const { items, meta } = await productService.adminList(req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => {
    ok(res, await productService.adminGet(req.params.id));
  })
  .patch('/:id', validate(adminUpdateProduct), async (req, res) => {
    ok(res, await productService.adminUpdate(req.params.id, req.body, actorOf(req)));
  })
  .post('/:id/review', validate(reviewProduct), async (req, res) => {
    ok(res, await productService.adminReview(req.params.id, req.body, actorOf(req)));
  });
