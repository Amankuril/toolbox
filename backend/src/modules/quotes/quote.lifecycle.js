import { cartService } from '#modules/cart/cart.service.js';
import { Quote } from './quote.model.js';

const quoteIdsOf = (order) => order.items.map((i) => i.pricing?.quote).filter(Boolean);

/**
 * Quote state changes driven by orders and time. Kept apart from the quote service so the
 * order flow can use it without pulling in the request/response logic.
 */
export const quoteLifecycle = {
  /** The order that uses a quote consumes it. */
  async markOrdered(order) {
    const ids = quoteIdsOf(order);
    if (!ids.length) return;
    await Quote.updateMany(
      { _id: { $in: ids }, status: { $in: ['accepted', 'expired'] } },
      { status: 'ordered', order: order._id, $push: { history: { status: 'ordered', by: { kind: 'user', id: order.user }, at: new Date() } } },
    );
  },

  /** The order never completed (payment failed / timed out): give the quote back if it's still valid. */
  async releaseForOrder(order) {
    const ids = quoteIdsOf(order);
    if (!ids.length) return;
    const now = new Date();
    const scope = { _id: { $in: ids }, status: 'ordered', order: order._id };
    const note = 'Order was not completed';
    await Quote.updateMany(
      { ...scope, 'offer.validUntil': { $gt: now } },
      { status: 'accepted', $unset: { order: 1 }, $push: { history: { status: 'accepted', by: { kind: 'system' }, at: now, note } } },
    );
    await Quote.updateMany(scope, {
      status: 'expired',
      $unset: { order: 1 },
      $push: { history: { status: 'expired', by: { kind: 'system' }, at: now, note } },
    });
  },

  /** Job: expire offers past their validity and pull them out of carts. */
  async expireStale(now = new Date()) {
    const stale = await Quote.find({ status: { $in: ['quoted', 'accepted'] }, 'offer.validUntil': { $lte: now } })
      .select('_id')
      .limit(500)
      .lean();
    if (!stale.length) return 0;
    const ids = stale.map((q) => q._id);
    await Quote.updateMany(
      { _id: { $in: ids }, status: { $in: ['quoted', 'accepted'] } },
      { status: 'expired', $push: { history: { status: 'expired', by: { kind: 'system' }, at: now } } },
    );
    await cartService.removeQuotes(ids);
    return ids.length;
  },
};
