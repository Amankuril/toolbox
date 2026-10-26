import mongoose from 'mongoose';
import { env } from '#config/env.js';
import { escapeRegex } from '#core/utils/strings.js';
import { Product } from '#modules/products/product.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { WishlistItem } from './wishlist.model.js';

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const appUrl = (path) => `${env.PUBLIC_APP_URL.replace(/\/+$/, '')}${path}`;

/** The reminder a seller (or the store) sends about a saved product. */
function reminderText({ from, customer, product }) {
  const price = product.pricing?.price;
  const off = product.pricing?.mrp > price ? Math.round(((product.pricing.mrp - price) / product.pricing.mrp) * 100) : 0;
  return `Hi ${customer.split(' ')[0]}, greetings from ${from}! 💚 ${product.name} is still in your wishlist${price ? ` at ${rupees(price)}${off ? ` (${off}% off)` : ''}` : ''}. Order now before it runs out 👉 ${appUrl(`/p/${product.slug}`)}`;
}

/** Products and customers in scope: a seller's own products, or everything (admins). */
async function scopeFilter({ vendorId, vendor, product, q, days }) {
  const productFilter = {};
  if (vendorId || vendor) productFilter.vendor = vendorId ?? vendor;
  if (product) productFilter._id = product;
  if (q) productFilter.name = new RegExp(escapeRegex(q), 'i');
  const filter = {};
  if (Object.keys(productFilter).length) {
    const ids = await Product.distinct('_id', productFilter);
    filter.product = { $in: ids };
  }
  if (days) filter.createdAt = { $gte: new Date(Date.now() - days * 24 * 60 * 60 * 1000) };
  return filter;
}

export const wishlistInsights = {
  /** Who saved what, newest first, with product and customer details. */
  async list(scope, { page, limit, ...query }) {
    const filter = await scopeFilter({ ...scope, ...query });
    const [rows, total, top] = await Promise.all([
      WishlistItem.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('user', 'name phone email status')
        .populate({ path: 'product', select: 'name slug images pricing inventory variants status vendor', populate: { path: 'vendor', select: 'store.name' } })
        .lean(),
      WishlistItem.countDocuments(filter),
      // The most saved products in scope, for the summary strip.
      WishlistItem.aggregate([
        { $match: filter },
        { $group: { _id: '$product', saves: { $sum: 1 } } },
        { $sort: { saves: -1 } },
        { $limit: 5 },
        { $lookup: { from: Product.collection.name, localField: '_id', foreignField: '_id', as: 'p', pipeline: [{ $project: { name: 1, images: 1 } }] } },
      ]),
    ]);
    return {
      items: rows
        .filter((r) => r.user && r.product)
        .map((r) => ({
          _id: r._id,
          savedAt: r.createdAt,
          remindedAt: r.remindedAt ?? null,
          customer: { _id: r.user._id, name: r.user.name, phone: r.user.phone ?? null, email: r.user.email ?? null },
          product: {
            _id: r.product._id,
            name: r.product.name,
            slug: r.product.slug,
            image: r.product.images?.[0]?.url ?? null,
            price: r.product.pricing?.price,
            mrp: r.product.pricing?.mrp,
            stock: r.product.inventory?.trackQuantity === false ? null : (r.product.inventory?.stock ?? 0),
            live: r.product.status === 'active',
            seller: r.product.vendor?.store?.name ?? null,
          },
        })),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        top: top.map((t) => ({ _id: t._id, saves: t.saves, name: t.p[0]?.name, image: t.p[0]?.images?.[0]?.url ?? null })),
      },
    };
  },

  /**
   * Reminder messages for the chosen saves (or every save matching the filters, up to 500), marked as reminded.
   * Each comes with the WhatsApp text for that customer and product.
   */
  async remind(scope, { ids, ...query }) {
    // Chosen rows still have to be in scope: a seller can only remind about their own products.
    const filter = await scopeFilter(ids?.length ? scope : { ...scope, ...query });
    if (ids?.length) filter._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(String(id))) };
    const rows = await WishlistItem.find(filter).sort({ createdAt: -1 }).limit(500).populate('user', 'name phone status').populate('product', 'name slug pricing status').lean();
    const usable = rows.filter((r) => r.user?.status === 'active' && r.user.phone && r.product?.status === 'active');
    const from = scope.vendorId
      ? ((await Vendor.findById(scope.vendorId).select('store.name').lean())?.store?.name ?? 'us')
      : (await settingsService.get('branding')).siteName;
    await WishlistItem.updateMany({ _id: { $in: usable.map((r) => r._id) } }, { remindedAt: new Date() });
    return usable.map((r) => ({
      _id: r._id,
      customer: { _id: r.user._id, name: r.user.name, phone: r.user.phone },
      product: { name: r.product.name },
      message: reminderText({ from, customer: r.user.name, product: r.product }),
    }));
  },
};

