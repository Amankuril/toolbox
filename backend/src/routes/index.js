import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { pincode } from '#core/validation/common.js';
import { pincodeService } from '#services/pincode/pincode.service.js';
import { ok } from '#core/utils/response.js';
import { adminManagementRoutes, adminSelfRoutes } from '#modules/admins/admin.routes.js';
import { authenticate } from '#modules/auth/auth.middleware.js';
import authRoutes from '#modules/auth/auth.routes.js';
import { adminBannerRoutes, publicBannerRoutes } from '#modules/banners/banner.routes.js';
import { cartRoutes } from '#modules/cart/cart.routes.js';
import { adminCategoryRoutes, publicCategoryRoutes, vendorCategoryRoutes } from '#modules/categories/category.routes.js';
import { dashboardService } from '#modules/dashboard/dashboard.service.js';
import { adminMediaRouter, mediaUploadRouter } from '#modules/media/media.routes.js';
import { adminOrderRoutes, userOrderRoutes, vendorOrderRoutes } from '#modules/orders/order.routes.js';
import { vendorProductImportRoutes } from '#modules/products/imports/import.routes.js';
import { adminProductRoutes, publicProductRoutes, vendorProductRoutes } from '#modules/products/product.routes.js';
import { adminQuoteRoutes, userQuoteRoutes, vendorQuoteRoutes } from '#modules/quotes/quote.routes.js';
import { adminSettingsRoutes, publicSettingsRoutes } from '#modules/settings/settings.routes.js';
import { adminShippingRoutes, publicShippingRoutes, userShippingRoutes, vendorShippingRoutes } from '#modules/shipping/shipping.routes.js';
import { adminUserRoutes, userSelfRoutes } from '#modules/users/user.routes.js';
import { adminVendorRoutes, publicStoreRoutes, vendorSelfRoutes } from '#modules/vendors/vendor.routes.js';

/**
 * /api/v1
 *   /auth     OTP (user, vendor), admin login, refresh, logout
 *   /public   anonymous storefront data
 *   /user     signed-in customer
 *   /vendor   signed-in seller
 *   /admin    signed-in admin
 */
export function buildRoutes() {
  const api = Router();

  api.use('/auth', authRoutes);

  const publicApi = Router()
    .use('/settings', publicSettingsRoutes)
    .use('/categories', publicCategoryRoutes)
    .use('/products', publicProductRoutes)
    .use('/stores', publicStoreRoutes)
    .use('/banners', publicBannerRoutes)
    .use('/shipping', publicShippingRoutes)
    .get(
      '/pincodes/:pincode',
      rateLimit({ keyPrefix: 'pincode', points: 30, duration: 60 }),
      validate({ params: z.object({ pincode }) }),
      async (req, res) => {
        res.set('Cache-Control', 'public, max-age=86400');
        ok(res, await pincodeService.lookup(req.params.pincode));
      },
    );
  api.use('/public', publicApi);

  const userApi = Router()
    .use(authenticate('user'))
    .use(userSelfRoutes)
    .use('/cart', cartRoutes)
    .use('/orders', userOrderRoutes)
    .use('/quotes', userQuoteRoutes)
    .use(userShippingRoutes)
    .use('/media', mediaUploadRouter());
  api.use('/user', userApi);

  const vendorApi = Router()
    .use(authenticate('vendor'))
    .use(vendorSelfRoutes)
    .get('/dashboard', async (req, res) => ok(res, await dashboardService.vendor(req.auth.id)))
    .use('/categories', vendorCategoryRoutes)
    .use('/products', vendorProductRoutes)
    .use('/product-imports', vendorProductImportRoutes)
    .use('/orders', vendorOrderRoutes)
    .use('/quotes', vendorQuoteRoutes)
    .use(vendorShippingRoutes)
    .use('/media', mediaUploadRouter());
  api.use('/vendor', vendorApi);

  const adminApi = Router()
    .use(authenticate('admin'))
    .use(adminSelfRoutes)
    .get('/dashboard', async (_req, res) => ok(res, await dashboardService.admin()))
    .use('/admins', adminManagementRoutes)
    .use('/vendors', adminVendorRoutes)
    .use('/users', adminUserRoutes)
    .use('/categories', adminCategoryRoutes)
    .use('/products', adminProductRoutes)
    .use('/orders', adminOrderRoutes)
    .use('/quotes', adminQuoteRoutes)
    .use('/banners', adminBannerRoutes)
    .use('/media', adminMediaRouter())
    .use('/settings', adminSettingsRoutes)
    .use(adminShippingRoutes);
  api.use('/admin', adminApi);

  return api;
}
