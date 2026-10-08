import { Router } from 'express';
import { z } from 'zod';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { validate } from '#core/middlewares/validate.js';
import { pincode } from '#core/validation/common.js';
import { pincodeService } from '#services/pincode/pincode.service.js';
import { ok } from '#core/utils/response.js';
import { adminManagementRoutes, adminSelfRoutes } from '#modules/admins/admin.routes.js';
import { requireSection } from '#modules/admins/permissions.js';
import { authenticate } from '#modules/auth/auth.middleware.js';
import authRoutes from '#modules/auth/auth.routes.js';
import { adminBannerRoutes, publicBannerRoutes } from '#modules/banners/banner.routes.js';
import { cartRoutes } from '#modules/cart/cart.routes.js';
import { vendorCouponRoutes } from '#modules/coupons/coupon.routes.js';
import { userChatRoutes, vendorLeadRoutes } from '#modules/leads/leads.routes.js';
import { wishlistRoutes } from '#modules/wishlist/wishlist.routes.js';
import { actAsStore } from '#modules/store/store.service.js';
import { storeSettingsRoutes } from '#modules/store/store.routes.js';
import { adminCategoryRoutes, publicCategoryRoutes, vendorCategoryRoutes } from '#modules/categories/category.routes.js';
import { dashboardService } from '#modules/dashboard/dashboard.service.js';
import { adminMediaRouter, mediaUploadRouter } from '#modules/media/media.routes.js';
import { adminOrderRoutes, userOrderRoutes, vendorOrderRoutes } from '#modules/orders/order.routes.js';
import { adminProductImportRoutes, vendorProductImportRoutes } from '#modules/products/imports/import.routes.js';
import { adminProductRoutes, publicProductRoutes, vendorProductRoutes } from '#modules/products/product.routes.js';
import { adminQuoteRoutes, userQuoteRoutes, vendorQuoteRoutes } from '#modules/quotes/quote.routes.js';
import { adminReviewRoutes, publicReviewRoutes, userReviewRoutes } from '#modules/reviews/review.routes.js';
import { storeStats } from '#modules/products/store.stats.js';
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
    .use('/products', publicReviewRoutes)
    .get('/stats', async (_req, res) => {
      res.set('Cache-Control', 'public, max-age=600');
      ok(res, await storeStats());
    })
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
    .use('/wishlist', wishlistRoutes)
    .use('/orders', userOrderRoutes)
    .use('/quotes', userQuoteRoutes)
    .use('/products', userReviewRoutes)
    .use(userShippingRoutes)
    .use(userChatRoutes)
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
    .use('/coupons', vendorCouponRoutes)
    .use('/leads', vendorLeadRoutes)
    .use(vendorShippingRoutes)
    .use('/media', mediaUploadRouter());
  api.use('/vendor', vendorApi);

  // The platform's own store: the seller routes, run as the house store by admins with "store" access.
  const storeApi = Router()
    .use(storeSettingsRoutes)
    .get('/dashboard', async (req, res) => ok(res, await dashboardService.vendor(req.auth.id)))
    .use('/categories', vendorCategoryRoutes)
    .use('/products', vendorProductRoutes)
    .use('/product-imports', vendorProductImportRoutes)
    .use('/orders', vendorOrderRoutes)
    .use('/quotes', vendorQuoteRoutes)
    .use('/coupons', vendorCouponRoutes)
    .use('/leads', vendorLeadRoutes)
    .use(vendorShippingRoutes)
    .use('/media', mediaUploadRouter());

  // Every admin section is guarded: reads need view access, changes need manage (see admins/permissions.js).
  const adminApi = Router()
    .use(authenticate('admin'))
    .use(adminSelfRoutes)
    .get('/dashboard', requireSection('dashboard'), async (_req, res) => ok(res, await dashboardService.admin()))
    .use('/admins', adminManagementRoutes)
    .use('/vendors', requireSection('vendors', { readableBy: ['products'], readablePath: /^\/(?:[0-9a-f]{24})?$/i }), adminVendorRoutes)
    .use('/users', requireSection('customers'), adminUserRoutes)
    .use('/categories', requireSection('categories', { readableBy: ['products'] }), adminCategoryRoutes)
    .use('/products', requireSection('products'), adminProductRoutes)
    .use('/product-imports', requireSection('products'), adminProductImportRoutes)
    .use('/orders', requireSection('orders'), adminOrderRoutes)
    .use(['/shipments', '/shipping'], requireSection('orders'))
    .use('/quotes', requireSection('quotes'), adminQuoteRoutes)
    .use('/reviews', requireSection('reviews'), adminReviewRoutes)
    .use('/banners', requireSection('banners'), adminBannerRoutes)
    // Uploading is part of whichever section the file is for (banners, categories, branding…);
    // browsing and deleting the library is its own permission.
    .use('/media', requireSection('media', { writeMethods: ['DELETE'] }), adminMediaRouter())
    .use('/settings', requireSection('settings'), adminSettingsRoutes)
    .use('/store', requireSection('store'), actAsStore, storeApi)
    .use(adminShippingRoutes);
  api.use('/admin', adminApi);

  return api;
}
