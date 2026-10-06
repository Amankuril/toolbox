import { ApiError } from '#core/errors/ApiError.js';
import { Admin } from '#modules/admins/admin.model.js';
import { serializeAdmin } from '#modules/admins/admin.serializer.js';
import { User } from '#modules/users/user.model.js';
import { serializeUser } from '#modules/users/user.serializer.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { serializeVendor } from '#modules/vendors/vendor.serializer.js';

/**
 * Per-audience account behaviour, so auth code can treat user / vendor / admin uniformly.
 */
export const accounts = {
  user: {
    model: User,
    serialize: serializeUser,
    assertCanSignIn(user) {
      if (user.status === 'blocked') {
        throw ApiError.forbidden('Your account has been blocked. Please contact support.', { code: 'ACCOUNT_BLOCKED' });
      }
    },
  },
  vendor: {
    model: Vendor,
    serialize: serializeVendor,
    assertCanSignIn(vendor) {
      if (vendor.isPlatform) {
        throw ApiError.forbidden('This store is managed from the admin panel.', { code: 'PLATFORM_STORE' });
      }
      if (vendor.status === 'suspended') {
        throw ApiError.forbidden('Your seller account is suspended. Please contact support.', { code: 'ACCOUNT_SUSPENDED' });
      }
    },
  },
  admin: {
    model: Admin,
    serialize: serializeAdmin,
    assertCanSignIn(admin) {
      if (admin.status !== 'active') {
        throw ApiError.forbidden('This admin account is disabled.', { code: 'ACCOUNT_DISABLED' });
      }
    },
  },
};
