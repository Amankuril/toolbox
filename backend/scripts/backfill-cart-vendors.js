/**
 * One-off: copies each cart line's seller onto it (carts saved before seller leads existed).
 * Safe to re-run. Leaves updatedAt alone, so carts keep their abandoned / active status.
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '#config/db.js';
import { Cart } from '#modules/cart/cart.model.js';
import { Product } from '#modules/products/product.model.js';

await connectDatabase();
let carts = 0;
const cursor = Cart.find({ items: { $elemMatch: { vendor: { $exists: false } } } }, 'items')
  .lean()
  .cursor();
for await (const cart of cursor) {
  const products = await Product.find({ _id: { $in: cart.items.map((i) => i.product) } }, 'vendor').lean();
  const vendorOf = new Map(products.map((p) => [String(p._id), p.vendor]));
  const $set = {};
  cart.items.forEach((item, i) => {
    const vendor = vendorOf.get(String(item.product));
    if (!item.vendor && vendor) $set[`items.${i}.vendor`] = vendor;
  });
  if (Object.keys($set).length) {
    await Cart.updateOne({ _id: cart._id }, { $set }, { timestamps: false });
    carts += 1;
  }
}
console.log(`Backfilled sellers on ${carts} cart(s)`);
await disconnectDatabase();
await mongoose.disconnect();
process.exit(0);
