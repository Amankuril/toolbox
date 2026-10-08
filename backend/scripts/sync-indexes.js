/**
 * Builds/updates every collection's indexes to match the Mongoose schemas.
 * Run on deploy (see deploy/README.md) — it also drops indexes removed from schemas.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '#config/db.js';
import '#modules/admins/admin.model.js';
import '#modules/auth/session.model.js';
import '#modules/banners/banner.model.js';
import '#modules/cart/cart.model.js';
import '#modules/wishlist/wishlist.model.js';
import '#modules/categories/category.model.js';
import '#modules/coupons/coupon.model.js';
import '#modules/leads/lead.model.js';
import '#modules/media/media.model.js';
import '#modules/orders/order.model.js';
import '#modules/products/product.model.js';
import '#modules/products/imports/import.model.js';
import '#modules/quotes/quote.model.js';
import '#modules/reviews/review.model.js';
import '#modules/settings/setting.model.js';
import '#modules/shipping/shipment.model.js';
import '#modules/users/user.model.js';
import '#modules/vendors/vendor.model.js';

await connectDatabase();
for (const model of Object.values(mongoose.models)) {
  const dropped = await model.syncIndexes();
  console.log(`${model.modelName}: synced${dropped.length ? `, dropped ${dropped.join(', ')}` : ''}`);
}
await disconnectDatabase();
process.exit(0);
