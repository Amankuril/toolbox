import { Product } from '#modules/products/product.model.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { VISIBLE } from './product.service.js';

const TTL_MS = 10 * 60_000;
// Below these, a number reads as small rather than reassuring, so it isn't shown at all.
const MIN = { products: 50, sellers: 5, customers: 100 };
let cache = null;

/** 1,234 → 1,200; 87 → 80: "1,200+" never overstates the real count. */
const floorNice = (n) => {
  const step = n >= 100_000 ? 10_000 : n >= 10_000 ? 1_000 : n >= 1_000 ? 100 : 10;
  return Math.floor(n / step) * step;
};

/** Real, live storefront counts for the trust band. Cached per instance for 10 minutes. */
export async function storeStats() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;
  const [products, sellers, customers] = await Promise.all([
    Product.countDocuments(VISIBLE),
    Vendor.countDocuments({ status: 'approved', isPlatform: { $ne: true } }),
    User.countDocuments({ status: 'active' }),
  ]);
  const raw = { products, sellers, customers };
  const value = Object.fromEntries(Object.entries(raw).map(([k, n]) => [k, n >= MIN[k] ? floorNice(n) : null]));
  cache = { at: Date.now(), value };
  return value;
}
