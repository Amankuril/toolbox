import mongoose from 'mongoose';
import { Order } from '#modules/orders/order.model.js';
import { settingsService } from '#services/settings/settings.service.js';

const TTL_MS = 10 * 60_000;
const memo = new Map();

/**
 * "N people bought this recently": distinct buyers of the product in the configured window, from paid or
 * placed orders that weren't cancelled. Null when switched off or below the minimum. Cached a few minutes per product.
 */
export async function recentBuyers(productId) {
  const { recentBuyersEnabled, recentBuyersDays, recentBuyersMin } = await settingsService.get('storefront');
  if (!recentBuyersEnabled) return null;
  const key = `${productId}:${recentBuyersDays}`;
  const hit = memo.get(key);
  let count = hit && hit.at > Date.now() - TTL_MS ? hit.count : null;
  if (count == null) {
    const id = new mongoose.Types.ObjectId(String(productId));
    const [row] = await Order.aggregate([
      {
        $match: {
          'items.product': id,
          createdAt: { $gte: new Date(Date.now() - recentBuyersDays * 24 * 60 * 60_000) },
          status: { $in: ['placed', 'processing', 'completed'] },
        },
      },
      { $match: { items: { $elemMatch: { product: id, status: { $ne: 'cancelled' } } } } },
      { $group: { _id: '$user' } },
      { $count: 'buyers' },
    ]);
    count = row?.buyers ?? 0;
    if (memo.size > 10_000) memo.clear();
    memo.set(key, { count, at: Date.now() });
  }
  return count >= recentBuyersMin ? { count, days: recentBuyersDays } : null;
}
