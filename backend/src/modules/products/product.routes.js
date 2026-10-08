import crypto from 'node:crypto';
import { Router } from 'express';
import { catalogGeneration, remember } from '#core/cache/cached.js';
import { rateLimit } from '#core/middlewares/rateLimit.js';
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

/** Stable key for a validated query object (key order doesn't matter). */
const cacheKeyOf = (query) =>
  crypto
    .createHash('sha1')
    .update(JSON.stringify(Object.entries(query).sort(([a], [b]) => a.localeCompare(b))))
    .digest('base64url');

// Typeahead fires per keystroke (debounced); a miss scans the catalogue, so it gets its own budget.
const suggestLimit = rateLimit({ keyPrefix: 'suggest', points: 120, duration: 60 });

export const publicProductRoutes = Router()
  .get('/', validate(publicListProducts), async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    // Identical listings (home page, popular categories) are built once until the catalogue changes (or 30 s, like the HTTP cache).
    const gen = await catalogGeneration.current();
    const { items, meta, facets } = await remember(`products:list:${gen}:${cacheKeyOf(req.query)}`, 30, () =>
      productService.publicList(req.query),
    );
    ok(res, items, { ...meta, facets });
  })
  .get('/suggest', suggestLimit, validate(suggestQuery), async (req, res) => {
    res.set('Cache-Control', 'public, max-age=30');
    const gen = await catalogGeneration.current();
    ok(
      res,
      await remember(`products:suggest:${gen}:${cacheKeyOf({ q: req.query.q.toLowerCase() })}`, 60, () =>
        productService.suggest(req.query.q),
      ),
    );
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
    ok(res, await productService.compatibilityCandidates(req.query.q, req.auth.id));
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
