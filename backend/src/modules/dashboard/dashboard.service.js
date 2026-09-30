import mongoose from 'mongoose';
import { Category } from '#modules/categories/category.model.js';
import { Order } from '#modules/orders/order.model.js';
import { serializeOrder, serializeVendorOrder } from '#modules/orders/order.serializer.js';
import { Product } from '#modules/products/product.model.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';

const TIMEZONE = 'Asia/Kolkata';
const DAY = 24 * 60 * 60 * 1000;
const COUNTED = { $nin: ['pending_payment', 'cancelled'] };

const byStatus = (rows) => Object.fromEntries(rows.map((r) => [r._id, r.count]));
const groupStatus = [{ $group: { _id: '$status', count: { $sum: 1 } } }];

/** Fills gaps so charts get one point per day even with no sales. */
function dailySeries(rows, days) {
  const map = new Map(rows.map((r) => [r._id, r]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const key = new Date(Date.now() - i * DAY).toLocaleDateString('en-CA', { timeZone: TIMEZONE });
    out.push({ date: key, revenue: map.get(key)?.revenue ?? 0, orders: map.get(key)?.orders ?? 0 });
  }
  return out;
}

export const dashboardService = {
  async admin() {
    const since30 = new Date(Date.now() - 30 * DAY);
    const since14 = new Date(Date.now() - 14 * DAY);

    const [users, vendors, products, pendingCategories, orders, revenue, recent, daily] = await Promise.all([
      User.countDocuments(),
      Vendor.aggregate(groupStatus),
      Product.aggregate(groupStatus),
      Category.countDocuments({ status: 'pending' }),
      Order.aggregate(groupStatus),
      Order.aggregate([
        { $match: { createdAt: { $gte: since30 }, status: COUNTED } },
        { $group: { _id: null, gmv: { $sum: '$amounts.total' }, orders: { $sum: 1 } } },
      ]),
      Order.find({ status: { $ne: 'pending_payment' } }).sort({ createdAt: -1 }).limit(8).populate('user', 'name phone').lean(),
      Order.aggregate([
        { $match: { createdAt: { $gte: since14 }, status: COUNTED } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } },
            revenue: { $sum: '$amounts.total' },
            orders: { $sum: 1 },
          },
        },
      ]),
    ]);

    const vendorCounts = byStatus(vendors);
    const productCounts = byStatus(products);
    return {
      totals: {
        users,
        vendors: Object.values(vendorCounts).reduce((a, b) => a + b, 0),
        products: Object.entries(productCounts).reduce((sum, [status, n]) => (status === 'archived' ? sum : sum + n), 0),
        orders: Object.values(byStatus(orders)).reduce((a, b) => a + b, 0),
      },
      last30Days: { gmv: revenue[0]?.gmv ?? 0, orders: revenue[0]?.orders ?? 0 },
      pendingApprovals: {
        vendors: vendorCounts.pending_review ?? 0,
        products: productCounts.pending ?? 0,
        categories: pendingCategories,
      },
      vendorsByStatus: vendorCounts,
      productsByStatus: productCounts,
      ordersByStatus: byStatus(orders),
      dailySales: dailySeries(daily, 14),
      recentOrders: recent.map((o) => ({ ...serializeOrder(o), user: o.user })),
    };
  },

  async vendor(vendorId) {
    const id = new mongoose.Types.ObjectId(String(vendorId));
    const since30 = new Date(Date.now() - 30 * DAY);
    const since14 = new Date(Date.now() - 14 * DAY);
    const vendorLines = [{ $unwind: '$items' }, { $match: { 'items.vendor': id } }];

    const [products, lowStock, itemStatuses, revenue, daily, recent] = await Promise.all([
      Product.aggregate([{ $match: { vendor: id } }, ...groupStatus]),
      Product.find({ vendor: id, status: 'active', 'inventory.stock': { $lte: 5 } })
        .sort({ 'inventory.stock': 1 })
        .limit(6)
        .select('name slug images inventory.stock')
        .lean(),
      Order.aggregate([{ $match: { vendors: id, status: { $ne: 'pending_payment' } } }, ...vendorLines, { $group: { _id: '$items.status', count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { vendors: id, createdAt: { $gte: since30 }, status: COUNTED } },
        ...vendorLines,
        { $match: { 'items.status': { $ne: 'cancelled' } } },
        { $group: { _id: null, revenue: { $sum: '$items.lineTotal' }, units: { $sum: '$items.quantity' }, orders: { $addToSet: '$_id' } } },
      ]),
      Order.aggregate([
        { $match: { vendors: id, createdAt: { $gte: since14 }, status: COUNTED } },
        ...vendorLines,
        { $match: { 'items.status': { $ne: 'cancelled' } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } },
            revenue: { $sum: '$items.lineTotal' },
            orderIds: { $addToSet: '$_id' },
          },
        },
        { $project: { revenue: 1, orders: { $size: '$orderIds' } } },
      ]),
      Order.find({ vendors: id, status: { $ne: 'pending_payment' } }).sort({ createdAt: -1 }).limit(6).lean(),
    ]);

    return {
      productsByStatus: byStatus(products),
      itemsByStatus: byStatus(itemStatuses),
      last30Days: { revenue: revenue[0]?.revenue ?? 0, units: revenue[0]?.units ?? 0, orders: revenue[0]?.orders.length ?? 0 },
      dailySales: dailySeries(daily, 14),
      lowStock: lowStock.map((p) => ({ _id: p._id, name: p.name, slug: p.slug, image: p.images?.[0] ?? null, stock: p.inventory.stock })),
      recentOrders: recent.map((o) => serializeVendorOrder(o, id)),
    };
  },
};
