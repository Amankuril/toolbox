import mongoose from 'mongoose';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { Category } from '#modules/categories/category.model.js';
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
const istMidnight = (day) => new Date(`${day}T00:00:00+05:30`);
const MAX_RANGE_DAYS = 366;

/** Every IST calendar day from `from` to `to` inclusive (YYYY-MM-DD). */
function daysBetween(from, to) {
  const out = [];
  for (let t = istMidnight(from).getTime(); t <= istMidnight(to).getTime(); t += DAY) out.push(dayOf(new Date(t + 12 * 3600 * 1000)));
  return out;
}

/** Charts read best with 7–60 points: days up to two months, then weeks (from Monday), then months. */
function bucketing(dayCount) {
  if (dayCount <= 62) return 'day';
  if (dayCount <= 210) return 'week';
  return 'month';
}

function bucketKey(day, unit) {
  if (unit === 'day') return day;
  if (unit === 'month') return day.slice(0, 7);
  const d = new Date(`${day}T12:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7; // Monday = 0
  return new Date(d.getTime() - back * DAY).toISOString().slice(0, 10);
}

/**
 * The window a report covers: a preset (`days` up to today) or a custom `from`–`to`, plus the equally
 * long window just before it to compare against.
 */
export function resolveRange({ days, from, to }) {
  let list;
  if (from && to) {
    const [a, b] = from <= to ? [from, to] : [to, from];
    list = daysBetween(a, b).slice(-MAX_RANGE_DAYS);
  } else list = daysBack(days ?? 30);
  const start = istMidnight(list[0]);
  const end = new Date(istMidnight(list.at(-1)).getTime() + DAY);
  const prevEnd = start;
  const prevStart = new Date(start.getTime() - list.length * DAY);
  const prevList = daysBack(list.length, new Date(prevEnd.getTime() - DAY));
  return { days: list, prevDays: prevList, start, end, prevStart, prevEnd, unit: bucketing(list.length) };
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
        // Per seller, and marketplace-wide (a visitor of two stores counts once there).
        for (const key of [uvKey(vendor, day), uvKey('all', day)]) {
          await redis.pfadd(key, visitor);
          await redis.expire(key, KEEP_DAYS * 24 * 3600);
        }
      }
    } catch (err) {
      logger.warn({ err }, 'Could not record a page view');
    }
  },

  /** Store analytics for one seller (or the house store); the filters are the same as the marketplace report's. */
  seller(vendorId, filters) {
    return report({ ...filters, vendor: vendorId });
  },

  /** The whole marketplace (admin), optionally one seller's share of it. */
  marketplace(filters) {
    return report(filters);
  },
};

/** Visitors over a set of days for one seller ('all' = marketplace): HyperLogLog union, so repeat visitors count once. */
async function visitorCount(who, days) {
  if (!days.length) return 0;
  try {
    return await redis.pfcount(...days.map((d) => uvKey(who, d)));
  } catch (err) {
    logger.warn({ err }, 'Visitor count unavailable');
    return null;
  }
}

/**
 * The analytics report behind the seller, house store and admin pages.
 *
 * @param {{ days?: number, from?: string, to?: string, vendor?: string, category?: string, type?: string, payment?: string }} filters
 *   `category` includes its sub-categories; `category`/`type` narrow sales to those products and visits to their pages.
 */
async function report(filters) {
  const range = resolveRange(filters);
  const vid = filters.vendor ? oid(filters.vendor) : null;

  // Category / type filters become a product list.
  let productIds = null;
  let category = null;
  if (filters.category || filters.type) {
    if (filters.category) category = await Category.findById(filters.category).select('name level').lean();
    productIds = await Product.find({
      ...(vid ? { vendor: vid } : {}),
      ...(filters.category ? { categoryPath: oid(filters.category) } : {}),
      ...(filters.type ? { type: filters.type } : {}),
    }).distinct('_id');
  }

  const orderMatch = (start, end) => ({
    createdAt: { $gte: start, $lt: end },
    status: { $ne: 'pending_payment' },
    ...(vid ? { vendors: vid } : {}),
    ...(filters.payment ? { 'payment.method': filters.payment } : {}),
  });
  const itemMatch = { ...(vid ? { 'items.vendor': vid } : {}), ...(productIds ? { 'items.product': { $in: productIds } } : {}) };
  const lines = (start, end) => [
    { $match: orderMatch(start, end) },
    { $unwind: '$items' },
    ...(Object.keys(itemMatch).length ? [{ $match: itemMatch }] : []),
  ];
  const live = { $ne: ['$items.status', 'cancelled'] };
  const visitMatch = (days) => ({
    day: { $in: days },
    ...(vid ? { vendor: vid } : {}),
    ...(productIds ? { product: { $in: productIds } } : {}),
  });

  const totalsOf = async (start, end) => {
    const [row] = await Order.aggregate([
      ...lines(start, end),
      {
        $group: {
          _id: null,
          orders: { $addToSet: '$_id' },
          customers: { $addToSet: '$user' },
          revenue: { $sum: { $cond: [live, '$items.lineTotal', 0] } },
          units: { $sum: { $cond: [live, '$items.quantity', 0] } },
          discount: { $sum: { $cond: [live, '$items.discount', 0] } },
          cancelledLines: { $sum: { $cond: [live, 0, 1] } },
          lines: { $sum: 1 },
        },
      },
    ]);
    return {
      revenue: row?.revenue ?? 0,
      orders: row?.orders.length ?? 0,
      units: row?.units ?? 0,
      discount: row?.discount ?? 0,
      customers: row?.customers ?? [],
      cancelRate: row?.lines ? Math.round((row.cancelledLines / row.lines) * 1000) / 10 : 0,
    };
  };
  const dailyOf = (start, end) =>
    Order.aggregate([
      ...lines(start, end),
      { $match: { 'items.status': { $ne: 'cancelled' } } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: TIMEZONE } },
          revenue: { $sum: '$items.lineTotal' },
          units: { $sum: '$items.quantity' },
          orders: { $addToSet: '$_id' },
        },
      },
    ]);
  const viewsOf = (days) =>
    VisitDay.aggregate([
      { $match: visitMatch(days) },
      {
        $group: {
          _id: '$day',
          views: { $sum: '$views' },
          ...Object.fromEntries(TRAFFIC_SOURCES.map((k) => [k, { $sum: `$sources.${k}` }])),
        },
      },
    ]);

  const { start, end, prevStart, prevEnd } = range;
  const [
    cur,
    prev,
    daily,
    prevDaily,
    views,
    prevViews,
    byProduct,
    productViews,
    statuses,
    payments,
    cities,
    states,
    heat,
    byVendor,
    wishlisted,
  ] = await Promise.all([
    totalsOf(start, end),
    totalsOf(prevStart, prevEnd),
    dailyOf(start, end),
    dailyOf(prevStart, prevEnd),
    viewsOf(range.days),
    viewsOf(range.prevDays),
    Order.aggregate([
      ...lines(start, end),
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
      { $limit: 2000 },
    ]),
    VisitDay.aggregate([
      { $match: { ...visitMatch(range.days), product: productIds ? { $in: productIds } : { $ne: null } } },
      { $group: { _id: '$product', views: { $sum: '$views' } } },
      { $sort: { views: -1 } },
      { $limit: 200 },
    ]),
    Order.aggregate([...lines(start, end), { $group: { _id: '$items.status', count: { $sum: 1 } } }]),
    Order.aggregate([...lines(start, end), { $group: { _id: '$payment.method', orders: { $addToSet: '$_id' } } }]),
    Order.aggregate([
      ...lines(start, end),
      { $group: { _id: { city: '$shippingAddress.city', state: '$shippingAddress.state' }, orders: { $addToSet: '$_id' } } },
      { $project: { orders: { $size: '$orders' } } },
      { $sort: { orders: -1 } },
      { $limit: 8 },
    ]),
    Order.aggregate([
      ...lines(start, end),
      { $match: { 'items.status': { $ne: 'cancelled' } } },
      { $group: { _id: '$shippingAddress.state', revenue: { $sum: '$items.lineTotal' }, orders: { $addToSet: '$_id' } } },
      { $project: { revenue: 1, orders: { $size: '$orders' } } },
      { $sort: { revenue: -1 } },
      { $limit: 10 },
    ]),
    Order.aggregate([
      ...lines(start, end),
      {
        $group: {
          _id: {
            dow: { $dayOfWeek: { date: '$createdAt', timezone: TIMEZONE } },
            hour: { $hour: { date: '$createdAt', timezone: TIMEZONE } },
          },
          orders: { $addToSet: '$_id' },
        },
      },
      { $project: { orders: { $size: '$orders' } } },
    ]),
    vid
      ? []
      : Order.aggregate([
          ...lines(start, end),
          { $match: { 'items.status': { $ne: 'cancelled' } } },
          {
            $group: {
              _id: '$items.vendor',
              revenue: { $sum: '$items.lineTotal' },
              units: { $sum: '$items.quantity' },
              orders: { $addToSet: '$_id' },
            },
          },
          { $project: { revenue: 1, units: 1, orders: { $size: '$orders' } } },
          { $sort: { revenue: -1 } },
          { $limit: 10 },
        ]),
    (async () => {
      const ids = productIds ?? (vid ? await Product.find({ vendor: vid }).distinct('_id') : null);
      return WishlistItem.countDocuments({ ...(ids ? { product: { $in: ids } } : {}), createdAt: { $gte: start, $lt: end } });
    })(),
  ]);

  // Visitors: per-seller HyperLogLogs can't be narrowed to some products, so a product filter shows views only.
  const who = vid ? String(vid) : 'all';
  const [visitors, prevVisitors] = productIds
    ? [null, null]
    : await Promise.all([visitorCount(who, range.days), visitorCount(who, range.prevDays)]);

  // Returning = ordered (in scope) before the period too.
  const returning = cur.customers.length
    ? (
        await Order.distinct('user', {
          ...(vid ? { vendors: vid } : {}),
          user: { $in: cur.customers },
          createdAt: { $lt: start },
          status: { $ne: 'pending_payment' },
        })
      ).length
    : 0;

  /* ── Series, one point per bucket, with the previous period aligned by position. ── */
  const keys = [...new Set(range.days.map((d) => bucketKey(d, range.unit)))];
  const index = new Map(keys.map((k, i) => [k, i]));
  const blank = () =>
    keys.map((k) => ({
      key: k,
      revenue: 0,
      orders: 0,
      units: 0,
      views: 0,
      visitors: 0,
      prevRevenue: 0,
      prevOrders: 0,
      prevUnits: 0,
      prevViews: 0,
    }));
  const series = blank();
  const add = (rows, day, f) => f(series[index.get(bucketKey(day, range.unit))], rows);
  const salesByDay = new Map(daily.map((d) => [d._id, d]));
  const prevSalesByDay = new Map(prevDaily.map((d) => [d._id, d]));
  const viewsByDay = new Map(views.map((d) => [d._id, d.views]));
  const prevViewsByDay = new Map(prevViews.map((d) => [d._id, d.views]));
  range.days.forEach((day, i) => {
    const s = salesByDay.get(day);
    const p = prevSalesByDay.get(range.prevDays[i]);
    add(null, day, (b) => {
      b.revenue += s?.revenue ?? 0;
      b.orders += s?.orders.length ?? 0;
      b.units += s?.units ?? 0;
      b.views += viewsByDay.get(day) ?? 0;
      b.prevRevenue += p?.revenue ?? 0;
      b.prevOrders += p?.orders.length ?? 0;
      b.prevUnits += p?.units ?? 0;
      b.prevViews += prevViewsByDay.get(range.prevDays[i]) ?? 0;
    });
  });
  if (!productIds) {
    const bucketDays = keys.map((k) => range.days.filter((d) => bucketKey(d, range.unit) === k));
    const counts = await Promise.all(bucketDays.map((ds) => visitorCount(who, ds)));
    counts.forEach((c, i) => (series[i].visitors = c ?? 0));
  }

  /* ── Products: best sellers with their views, and viewed-but-unsold. ── */
  const viewsBy = new Map(productViews.map((v) => [String(v._id), v.views]));
  const top = byProduct.slice(0, 20).map((p) => {
    const v = viewsBy.get(String(p._id)) ?? 0;
    return {
      _id: p._id,
      name: p.name,
      image: p.image ?? null,
      slug: p.slug,
      units: p.units,
      revenue: p.revenue,
      orders: p.orders.length,
      views: v,
      conversion: v ? Math.round((p.orders.length / v) * 1000) / 10 : null,
    };
  });
  const sold = new Set(byProduct.map((p) => String(p._id)));
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

  /* ── Sales by category: top-level departments, or the sub-categories of the filtered one. ── */
  const level = category ? category.level + 1 : 0;
  const productCats = byProduct.length
    ? await Product.find({ _id: { $in: byProduct.map((p) => p._id) } })
        .select('categoryPath category')
        .lean()
    : [];
  const catOf = new Map(productCats.map((p) => [String(p._id), String(p.categoryPath?.[level] ?? p.category ?? '')]));
  const catTotals = new Map();
  for (const p of byProduct) {
    const c = catOf.get(String(p._id)) || 'unknown';
    const row = catTotals.get(c) ?? { revenue: 0, units: 0 };
    row.revenue += p.revenue;
    row.units += p.units;
    catTotals.set(c, row);
  }
  const catNames = new Map(
    (
      await Category.find({ _id: { $in: [...catTotals.keys()].filter((k) => /^[0-9a-f]{24}$/.test(k)) } })
        .select('name')
        .lean()
    ).map((c) => [String(c._id), c.name]),
  );
  const byCategory = [...catTotals.entries()]
    .map(([id, r]) => ({
      _id: id,
      name: id === String(filters.category) ? `${category?.name} (not in a sub-category)` : (catNames.get(id) ?? 'Uncategorised'),
      ...r,
    }))
    .sort((x, y) => y.revenue - x.revenue);

  const vendorNames = byVendor.length
    ? new Map(
        (
          await Vendor.find({ _id: { $in: byVendor.map((v) => v._id) } })
            .select('store.name isPlatform')
            .lean()
        ).map((v) => [String(v._id), v]),
      )
    : new Map();

  const sourceTotals = Object.fromEntries(TRAFFIC_SOURCES.map((k) => [k, views.reduce((n, d) => n + (d[k] ?? 0), 0)]));
  const totalViews = views.reduce((n, d) => n + d.views, 0);
  const prevTotalViews = prevViews.reduce((n, d) => n + d.views, 0);
  const aov = cur.orders ? Math.round(cur.revenue / cur.orders) : 0;
  const prevAov = prev.orders ? Math.round(prev.revenue / prev.orders) : 0;
  const conversion = visitors ? Math.round((cur.orders / visitors) * 1000) / 10 : null;
  const prevConversion = prevVisitors ? Math.round((prev.orders / prevVisitors) * 1000) / 10 : null;

  return {
    days: range.days.length,
    range: { from: range.days[0], to: range.days.at(-1), prevFrom: range.prevDays[0], prevTo: range.prevDays.at(-1), unit: range.unit },
    totals: {
      revenue: { value: cur.revenue, change: pct(cur.revenue, prev.revenue), previous: prev.revenue },
      orders: { value: cur.orders, change: pct(cur.orders, prev.orders), previous: prev.orders },
      units: { value: cur.units, change: pct(cur.units, prev.units), previous: prev.units },
      avgOrderValue: { value: aov, change: pct(aov, prevAov), previous: prevAov },
      visitors: { value: visitors, change: visitors != null ? pct(visitors, prevVisitors) : null, previous: prevVisitors },
      views: { value: totalViews, change: pct(totalViews, prevTotalViews), previous: prevTotalViews },
      conversionRate: { value: conversion, change: conversion != null && prevConversion ? pct(conversion, prevConversion) : null },
      customers: { value: cur.customers.length, returning, change: pct(cur.customers.length, prev.customers.length) },
      discount: { value: cur.discount, change: pct(cur.discount, prev.discount) },
      cancelRate: { value: cur.cancelRate, previous: prev.cancelRate },
      wishlisted: { value: wishlisted },
    },
    series,
    // Day-by-day view kept for older clients.
    daily: range.days.map((d) => ({
      date: d,
      revenue: salesByDay.get(d)?.revenue ?? 0,
      orders: salesByDay.get(d)?.orders.length ?? 0,
      views: viewsByDay.get(d) ?? 0,
    })),
    topProducts: top,
    mostViewedUnsold,
    byCategory,
    topVendors: byVendor.map((v) => ({
      _id: v._id,
      name: vendorNames.get(String(v._id))?.store?.name ?? 'Unknown seller',
      isPlatform: Boolean(vendorNames.get(String(v._id))?.isPlatform),
      revenue: v.revenue,
      orders: v.orders,
      units: v.units,
    })),
    // dow: 1 = Sunday … 7 = Saturday (MongoDB), hour 0–23 IST.
    heatmap: heat.map((h) => ({ dow: h._id.dow, hour: h._id.hour, orders: h.orders })),
    itemStatus: Object.fromEntries(statuses.map((x) => [x._id, x.count])),
    paymentMix: Object.fromEntries(payments.map((x) => [x._id, x.orders.length])),
    topCities: cities.map((c) => ({ city: c._id.city, state: c._id.state, orders: c.orders })),
    topStates: states.map((c) => ({ state: c._id, revenue: c.revenue, orders: c.orders })),
    sources: sourceTotals,
    filters: {
      category: category ? { _id: filters.category, name: category.name } : null,
      type: filters.type ?? null,
      payment: filters.payment ?? null,
    },
  };
}
