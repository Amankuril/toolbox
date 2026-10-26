import mongoose from 'mongoose';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { Order } from '#modules/orders/order.model.js';
import { Product } from '#modules/products/product.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { WishlistItem } from '#modules/wishlist/wishlist.model.js';
import { TRAFFIC_SOURCES, VisitDay } from './visit.model.js';

const TIMEZONE = 'Asia/Kolkata';
const DAY = 24 * 60 * 60 * 1000;
const KEEP_DAYS = 400;
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const dayOf = (date) => date.toLocaleDateString('en-CA', { timeZone: TIMEZONE });
const uvKey = (vendorId, day) => `uv:${vendorId}:${day}`;

/** Where a visit came from, from the referrer (or ?utm_source). */
export function sourceOf(referrer = '', utm = '') {
  const s = `${utm} ${referrer}`.toLowerCase();
  if (/whatsapp|wa\.me/.test(s)) return 'whatsapp';
  if (/google\./.test(s) || /\bgoogle\b/.test(utm)) return 'google';
  if (/facebook|fb\.|\bfb\b/.test(s)) return 'facebook';
  if (/instagram/.test(s)) return 'instagram';
  if (!referrer && !utm) return 'direct';
  return 'other';
}

// Product → seller, so a view costs one small lookup at most once per product per process.
const productVendor = new Map();
async function vendorOfProduct(productId) {
  if (productVendor.has(productId)) return productVendor.get(productId);
  const p = await Product.findOne({ _id: productId, status: 'active' }).select('vendor').lean();
  if (productVendor.size > 5_000) productVendor.clear();
  productVendor.set(productId, p?.vendor ?? null);
  return p?.vendor ?? null;
}

function daysBack(days, end = new Date()) {
  return Array.from({ length: days }, (_, i) => dayOf(new Date(end.getTime() - (days - 1 - i) * DAY)));
}

const pct = (now, before) => (before ? Math.round(((now - before) / before) * 1000) / 10 : null);

/** Order lines of one seller in a window: revenue counts lines that weren't cancelled. */
function sellerLines(vendorId, from, to) {
  return [
    { $match: { vendors: oid(vendorId), createdAt: { $gte: from, $lt: to }, status: { $ne: 'pending_payment' } } },
    { $unwind: '$items' },
    { $match: { 'items.vendor': oid(vendorId) } },
  ];
}

async function salesTotals(vendorId, from, to) {
  const [row] = await Order.aggregate([
    ...sellerLines(vendorId, from, to),
    {
      $group: {
        _id: null,
        orders: { $addToSet: '$_id' },
        customers: { $addToSet: '$user' },
        revenue: { $sum: { $cond: [{ $ne: ['$items.status', 'cancelled'] }, '$items.lineTotal', 0] } },
        units: { $sum: { $cond: [{ $ne: ['$items.status', 'cancelled'] }, '$items.quantity', 0] } },
        cancelledLines: { $sum: { $cond: [{ $eq: ['$items.status', 'cancelled'] }, 1, 0] } },
        lines: { $sum: 1 },
      },
    },
  ]);
  return {
    revenue: row?.revenue ?? 0,
    orders: row?.orders.length ?? 0,
    units: row?.units ?? 0,
    customers: row?.customers ?? [],
    cancelRate: row?.lines ? Math.round((row.cancelledLines / row.lines) * 1000) / 10 : 0,
  };
}

async function visitTotals(vendorId, days) {
  const [row] = await VisitDay.aggregate([
    { $match: { vendor: oid(vendorId), day: { $in: days } } },
    { $group: { _id: null, views: { $sum: '$views' } } },
  ]);
  let visitors = 0;
  try {
    // PFCOUNT over several keys counts the union: people who came on more than one day count once.
    visitors = await redis.pfcount(...days.map((d) => uvKey(vendorId, d)));
  } catch (err) {
    logger.warn({ err }, 'Visitor count unavailable');
  }
  return { views: row?.views ?? 0, visitors };
}

export const analyticsService = {
  /** A storefront page view (product or store page). Never throws: tracking must not break browsing. */
  async track({ productId, storeSlug, visitor, referrer, utm }) {
    try {
      let vendor = null;
      if (productId) vendor = await vendorOfProduct(productId);
      else if (storeSlug) vendor = (await Vendor.findOne({ 'store.slug': storeSlug, status: 'approved' }).select('_id').lean())?._id;
      if (!vendor) return;
      const day = dayOf(new Date());
      const source = sourceOf(referrer, utm);
      await VisitDay.updateOne(
        { vendor, product: productId ?? null, day },
        { $inc: { views: 1, [`sources.${source}`]: 1 }, $setOnInsert: { _expires: new Date(Date.now() + KEEP_DAYS * DAY) } },
        { upsert: true },
      );
      if (visitor) {
        const key = uvKey(vendor, day);
        await redis.pfadd(key, visitor);
        await redis.expire(key, KEEP_DAYS * 24 * 3600);
      }
    } catch (err) {
      logger.warn({ err }, 'Could not record a page view');
    }
  },

  /**
   * Everything a seller wants to know about the last `days` days, against the `days` before.
   */
  async seller(vendorId, { days }) {
    const vid = oid(vendorId);
    const now = new Date();
    const from = new Date(now.getTime() - days * DAY);
    const prevFrom = new Date(from.getTime() - days * DAY);
    const dayList = daysBack(days, now);
    const prevDays = daysBack(days, from);

    const [
      cur,
      prev,
      visits,
      prevVisits,
      daily,
      dailyVisits,
      products,
      productViews,
      statuses,
      payments,
      cities,
      visitSources,
      wishlisted,
    ] = await Promise.all([
      salesTotals(vendorId, from, now),
      salesTotals(vendorId, prevFrom, from),
      visitTotals(vendorId, dayList),
      visitTotals(vendorId, prevDays),
      Order.aggregate([
        ...sellerLines(vendorId, from, now),
        { $match: { 'items.status': { $ne: 'cancelled' } } },
        {
          $group: {
            _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } },
            revenue: { $sum: '$items.lineTotal' },
            orders: { $addToSet: '$_id' },
          },
        },
      ]),
      VisitDay.aggregate([{ $match: { vendor: vid, day: { $in: dayList } } }, { $group: { _id: '$day', views: { $sum: '$views' } } }]),
      Order.aggregate([
        ...sellerLines(vendorId, from, now),
        { $match: { 'items.status': { $ne: 'cancelled' } } },
        {
          $group: {
            _id: '$items.product',
            name: { $first: '$items.name' },
            image: { $first: '$items.image' },
            slug: { $first: '$items.slug' },
            units: { $sum: '$items.quantity' },
            revenue: { $sum: '$items.lineTotal' },
            orders: { $addToSet: '$_id' },
          },
        },
        { $sort: { revenue: -1 } },
        { $limit: 10 },
      ]),
      VisitDay.aggregate([
        { $match: { vendor: vid, day: { $in: dayList }, product: { $ne: null } } },
        { $group: { _id: '$product', views: { $sum: '$views' } } },
        { $sort: { views: -1 } },
        { $limit: 50 },
      ]),
      Order.aggregate([...sellerLines(vendorId, from, now), { $group: { _id: '$items.status', count: { $sum: 1 } } }]),
      Order.aggregate([
        { $match: { vendors: vid, createdAt: { $gte: from }, status: { $ne: 'pending_payment' } } },
        { $group: { _id: '$payment.method', count: { $sum: 1 } } },
      ]),
      Order.aggregate([
        { $match: { vendors: vid, createdAt: { $gte: from }, status: { $ne: 'pending_payment' } } },
        { $group: { _id: { city: '$shippingAddress.city', state: '$shippingAddress.state' }, orders: { $sum: 1 } } },
        { $sort: { orders: -1 } },
        { $limit: 8 },
      ]),
      VisitDay.aggregate([
        { $match: { vendor: vid, day: { $in: dayList } } },
        { $group: { _id: null, ...Object.fromEntries(TRAFFIC_SOURCES.map((s) => [s, { $sum: `$sources.${s}` }])) } },
      ]),
      Product.find({ vendor: vid })
        .select('_id')
        .lean()
        .then((ps) => WishlistItem.countDocuments({ product: { $in: ps.map((p) => p._id) }, createdAt: { $gte: from } })),
    ]);

    // Returning = ordered from this seller before the period too.
    const returning = cur.customers.length
      ? (
          await Order.distinct('user', {
            vendors: vid,
            user: { $in: cur.customers },
            createdAt: { $lt: from },
            status: { $ne: 'pending_payment' },
          })
        ).length
      : 0;

    // Views of the best sellers, and the most viewed products that didn't sell.
    const viewsBy = new Map(productViews.map((v) => [String(v._id), v.views]));
    const top = products.map((p) => {
      const views = viewsBy.get(String(p._id)) ?? 0;
      return {
        _id: p._id,
        name: p.name,
        image: p.image ?? null,
        slug: p.slug,
        units: p.units,
        revenue: p.revenue,
        orders: p.orders.length,
        views,
        conversion: views ? Math.round((p.orders.length / views) * 1000) / 10 : null,
      };
    });
    const sold = new Set(top.map((p) => String(p._id)));
    const unsoldIds = productViews.filter((v) => !sold.has(String(v._id))).slice(0, 5);
    const unsold = unsoldIds.length
      ? await Product.find({ _id: { $in: unsoldIds.map((v) => v._id) } })
          .select('name slug images')
          .lean()
      : [];
    const mostViewedUnsold = unsoldIds
      .map((v) => {
        const p = unsold.find((x) => String(x._id) === String(v._id));
        return p && { _id: p._id, name: p.name, slug: p.slug, image: p.images?.[0]?.url ?? null, views: v.views };
      })
      .filter(Boolean);

    const salesByDay = new Map(daily.map((d) => [d._id, d]));
    const viewsByDay = new Map(dailyVisits.map((d) => [d._id, d.views]));
    let visitorsByDay = dayList.map(() => 0);
    try {
      visitorsByDay = await Promise.all(dayList.map((d) => redis.pfcount(uvKey(vendorId, d))));
    } catch {
      // Redis unavailable: views still show.
    }

    const aov = cur.orders ? Math.round(cur.revenue / cur.orders) : 0;
    const prevAov = prev.orders ? Math.round(prev.revenue / prev.orders) : 0;
    const conversion = visits.visitors ? Math.round((cur.orders / visits.visitors) * 1000) / 10 : null;
    const prevConversion = prevVisits.visitors ? Math.round((prev.orders / prevVisits.visitors) * 1000) / 10 : null;

    return {
      days,
      totals: {
        revenue: { value: cur.revenue, change: pct(cur.revenue, prev.revenue) },
        orders: { value: cur.orders, change: pct(cur.orders, prev.orders) },
        units: { value: cur.units, change: pct(cur.units, prev.units) },
        avgOrderValue: { value: aov, change: pct(aov, prevAov) },
        visitors: { value: visits.visitors, change: pct(visits.visitors, prevVisits.visitors) },
        views: { value: visits.views, change: pct(visits.views, prevVisits.views) },
        conversionRate: { value: conversion, change: conversion != null && prevConversion ? pct(conversion, prevConversion) : null },
        customers: { value: cur.customers.length, returning, change: pct(cur.customers.length, prev.customers.length) },
        cancelRate: { value: cur.cancelRate },
        wishlisted: { value: wishlisted },
      },
      daily: dayList.map((d, i) => ({
        date: d,
        revenue: salesByDay.get(d)?.revenue ?? 0,
        orders: salesByDay.get(d)?.orders.length ?? 0,
        views: viewsByDay.get(d) ?? 0,
        visitors: visitorsByDay[i] ?? 0,
      })),
      topProducts: top,
      mostViewedUnsold,
      itemStatus: Object.fromEntries(statuses.map((s) => [s._id, s.count])),
      paymentMix: Object.fromEntries(payments.map((p) => [p._id, p.count])),
      topCities: cities.map((c) => ({ city: c._id.city, state: c._id.state, orders: c.orders })),
      sources: visitSources[0]
        ? Object.fromEntries(TRAFFIC_SOURCES.map((s) => [s, visitSources[0][s] ?? 0]))
        : Object.fromEntries(TRAFFIC_SOURCES.map((s) => [s, 0])),
    };
  },
};
