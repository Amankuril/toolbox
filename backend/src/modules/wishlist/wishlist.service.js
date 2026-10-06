import { ApiError } from '#core/errors/ApiError.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { CARD_FIELDS, serializeProductCard } from '#modules/products/product.serializer.js';
import { MAX_WISHLIST_ITEMS, WishlistItem } from './wishlist.model.js';

async function assertRoom(userId, adding) {
  const count = await WishlistItem.countDocuments({ user: userId });
  if (count + adding > MAX_WISHLIST_ITEMS) {
    throw ApiError.unprocessable(`Your wishlist can hold up to ${MAX_WISHLIST_ITEMS} items. Remove a few to add more.`, {
      code: 'WISHLIST_FULL',
    });
  }
}

export const wishlistService = {
  /** Saved products, newest first. Products taken down since are kept but flagged unavailable. */
  async list(userId) {
    const rows = await WishlistItem.find({ user: userId }).sort({ createdAt: -1 }).lean();
    const products = await Product.find({ _id: { $in: rows.map((r) => r.product) } }, `${CARD_FIELDS} status vendorApproved`).lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    return rows
      .map((r) => {
        const p = byId.get(String(r.product));
        if (!p) return null;
        const available = p.status === VISIBLE.status && p.vendorApproved === true;
        return { addedAt: r.createdAt, available, product: serializeProductCard(p) };
      })
      .filter(Boolean);
  },

  /** Just the ids, for heart states across the storefront. */
  async ids(userId) {
    const rows = await WishlistItem.find({ user: userId }, 'product').sort({ createdAt: -1 }).lean();
    return rows.map((r) => String(r.product));
  },

  async add(userId, productId) {
    if (await WishlistItem.exists({ user: userId, product: productId })) return this.ids(userId);
    const product = await Product.exists({ _id: productId, ...VISIBLE });
    if (!product) throw ApiError.notFound('Product not found');
    await assertRoom(userId, 1);
    await WishlistItem.updateOne(
      { user: userId, product: productId },
      { $setOnInsert: { user: userId, product: productId } },
      { upsert: true },
    );
    return this.ids(userId);
  },

  async remove(userId, productId) {
    await WishlistItem.deleteOne({ user: userId, product: productId });
    return this.ids(userId);
  },

  /** Folds a guest's saved items in after sign-in; unknown or hidden products are skipped. */
  async merge(userId, productIds) {
    const visible = await Product.find({ _id: { $in: productIds }, ...VISIBLE }, '_id').lean();
    const have = new Set(await this.ids(userId));
    const fresh = visible.map((p) => String(p._id)).filter((id) => !have.has(id));
    const room = Math.max(0, MAX_WISHLIST_ITEMS - have.size);
    if (fresh.length && room) {
      await WishlistItem.bulkWrite(
        fresh.slice(0, room).map((product) => ({
          updateOne: { filter: { user: userId, product }, update: { $setOnInsert: { user: userId, product } }, upsert: true },
        })),
        { ordered: false },
      );
    }
    return this.ids(userId);
  },
};
