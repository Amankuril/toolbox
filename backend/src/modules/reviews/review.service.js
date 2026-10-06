import mongoose from 'mongoose';
import { ApiError } from '#core/errors/ApiError.js';
import { Order } from '#modules/orders/order.model.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { Review } from './review.model.js';

const SORTS = {
  recent: { createdAt: -1 },
  highest: { rating: -1, createdAt: -1 },
  lowest: { rating: 1, createdAt: -1 },
};

/** "Pradip Kumar Panigrahi" → "Pradip P." — enough to feel real, not enough to identify. */
function displayName(name) {
  const parts = String(name ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return 'Verified buyer';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts.at(-1)[0].toUpperCase()}.`;
}

export function serializeReview(r, { admin = false } = {}) {
  return {
    _id: r._id,
    rating: r.rating,
    title: r.title ?? null,
    body: r.body ?? null,
    author: displayName(r.user?.name),
    verified: true,
    purchasedAt: r.purchasedAt ?? null,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    ...(admin
      ? {
          status: r.status,
          product: r.product,
          user: r.user ? { _id: r.user._id, name: r.user.name, phone: r.user.phone ?? null } : null,
          order: r.order,
          moderation: r.moderation ?? null,
        }
      : {}),
  };
}

/** The customer's delivered order line for this product, if any (proof of purchase). */
async function deliveredPurchase(userId, productId) {
  const order = await Order.findOne({ user: userId, items: { $elemMatch: { product: productId, status: 'delivered' } } }, 'items createdAt')
    .sort({ createdAt: -1 })
    .lean();
  if (!order) return null;
  const item = order.items.find((i) => String(i.product) === String(productId) && i.status === 'delivered');
  const deliveredAt = [...(item.history ?? [])].reverse().find((h) => h.status === 'delivered')?.at ?? order.createdAt;
  return { order: order._id, purchasedAt: deliveredAt };
}

/** Recomputes the product's stored rating from its published reviews (cheap: one indexed aggregate). */
async function refreshRating(productId) {
  const rows = await Review.aggregate([
    { $match: { product: new mongoose.Types.ObjectId(String(productId)), status: 'published' } },
    { $group: { _id: '$rating', n: { $sum: 1 } } },
  ]);
  const breakdown = [0, 0, 0, 0, 0];
  for (const r of rows) breakdown[r._id - 1] = r.n;
  const count = breakdown.reduce((a, b) => a + b, 0);
  const average = count ? Math.round((breakdown.reduce((sum, n, i) => sum + n * (i + 1), 0) / count) * 10) / 10 : 0;
  await Product.updateOne({ _id: productId }, { rating: { average, count, breakdown } });
  return { average, count, breakdown };
}

export const reviewService = {
  async listForProduct(productId, { page, limit, sort = 'recent', rating }) {
    const product = await Product.findOne({ _id: productId, ...VISIBLE }, 'rating').lean();
    if (!product) throw ApiError.notFound('Product not found');
    const filter = { product: productId, status: 'published', ...(rating ? { rating } : {}) };
    const [rows, total] = await Promise.all([
      Review.find(filter)
        .sort(SORTS[sort] ?? SORTS.recent)
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name')
        .lean(),
      Review.countDocuments(filter),
    ]);
    const summary = product.rating ?? { average: 0, count: 0, breakdown: [0, 0, 0, 0, 0] };
    return {
      summary: { average: summary.average, count: summary.count, breakdown: summary.breakdown },
      items: rows.map((r) => serializeReview(r)),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  /** What the signed-in customer can do: their existing review, and whether they may write one. */
  async mine(user, productId) {
    const [review, purchase] = await Promise.all([
      Review.findOne({ product: productId, user: user._id }).populate('user', 'name').lean(),
      deliveredPurchase(user._id, productId),
    ]);
    return { review: review ? { ...serializeReview(review), status: review.status } : null, canReview: Boolean(purchase) };
  },

  async upsert(user, productId, { rating, title, body }) {
    const product = await Product.findOne({ _id: productId, ...VISIBLE }, 'vendor').lean();
    if (!product) throw ApiError.notFound('Product not found');
    const purchase = await deliveredPurchase(user._id, productId);
    if (!purchase) {
      throw ApiError.forbidden('Only customers who received this item can review it.', { code: 'REVIEW_NOT_ELIGIBLE' });
    }
    const existing = await Review.findOne({ product: productId, user: user._id });
    // An admin-hidden review stays hidden even if edited; the customer can't re-publish it.
    const review = existing ?? new Review({ product: productId, vendor: product.vendor, user: user._id });
    review.set({ order: purchase.order, purchasedAt: purchase.purchasedAt, rating, title, body });
    try {
      await review.save();
    } catch (err) {
      if (err?.code === 11000) throw ApiError.conflict('You have already reviewed this product', { code: 'REVIEW_EXISTS' });
      throw err;
    }
    await refreshRating(productId);
    return this.mine(user, productId);
  },

  async remove(user, productId) {
    const res = await Review.deleteOne({ product: productId, user: user._id });
    if (!res.deletedCount) throw ApiError.notFound('Review not found');
    await refreshRating(productId);
  },

  /* ─────────────── Admin ─────────────── */

  async adminList({ page, limit, status, rating, product }) {
    const filter = { ...(status ? { status } : {}), ...(rating ? { rating } : {}), ...(product ? { product } : {}) };
    const [rows, total] = await Promise.all([
      Review.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name phone')
        .populate('product', 'name slug images')
        .lean(),
      Review.countDocuments(filter),
    ]);
    return {
      items: rows.map((r) => ({
        ...serializeReview(r, { admin: true }),
        product: r.product
          ? { _id: r.product._id, name: r.product.name, slug: r.product.slug, image: r.product.images?.[0] ?? null }
          : null,
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  async moderate(id, { status, note }, admin) {
    const review = await Review.findById(id);
    if (!review) throw ApiError.notFound('Review not found');
    review.status = status;
    review.moderation = { note, at: new Date(), by: admin.id };
    await review.save();
    await refreshRating(review.product);
    return serializeReview((await Review.findById(id).populate('user', 'name phone').lean()) ?? review, { admin: true });
  },

  refreshRating,
};
