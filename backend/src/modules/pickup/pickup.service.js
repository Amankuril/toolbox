import mongoose from 'mongoose';
import { ApiError } from '#core/errors/ApiError.js';
import { Vendor } from '#modules/vendors/vendor.model.js';

/** The business address as a pickup point has this id; warehouses use their own. */
export const MAIN_POINT = 'main';
const PICKUP_FIELDS = 'store.name phone status address pickup warehouses';

const addressOf = (a) => ({
  line1: a.line1,
  line2: a.line2,
  landmark: a.landmark,
  city: a.city,
  state: a.state,
  pincode: a.pincode,
});

/** Every place a buyer can collect from this seller, main address first. Empty when pickup is off. */
export function pickupPoints(vendor, { includeInactive = false } = {}) {
  if (!vendor?.pickup?.enabled) return [];
  const points = [];
  if (vendor.pickup.includeMainAddress !== false && vendor.address?.pincode) {
    points.push({
      _id: MAIN_POINT,
      name: vendor.store?.name ?? 'Main store',
      phone: vendor.store?.whatsapp ?? vendor.phone,
      ...addressOf(vendor.address),
      hours: vendor.pickup.hours ?? null,
      main: true,
    });
  }
  for (const w of vendor.warehouses ?? []) {
    if (!includeInactive && w.active === false) continue;
    points.push({
      _id: String(w._id),
      name: w.name,
      phone: w.phone ?? vendor.phone,
      ...addressOf(w),
      lat: w.lat ?? null,
      lng: w.lng ?? null,
      mapUrl: w.mapUrl ?? null,
      hours: w.hours ?? vendor.pickup.hours ?? null,
      main: false,
    });
  }
  return points;
}

const toRad = (d) => (d * Math.PI) / 180;
function km(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Nearest first. With the buyer's location and a pinned point, by distance; otherwise by how much of the
 * pincode matches (Indian pincodes are geographic: the first 3 digits are the sorting district), then city.
 */
function rank(points, { pincode, city, lat, lng }) {
  const here = Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  const scored = points.map((p) => {
    const distanceKm = here && p.lat != null && p.lng != null ? Math.round(km(here, p) * 10) / 10 : null;
    let common = 0;
    if (pincode) while (common < 6 && p.pincode?.[common] === pincode[common]) common += 1;
    const sameCity = city && p.city?.toLowerCase() === city.toLowerCase();
    return { ...p, distanceKm, nearby: common >= 3 || sameCity, _score: [distanceKm ?? Infinity, -common, sameCity ? 0 : 1] };
  });
  scored.sort((a, b) => a._score[0] - b._score[0] || a._score[1] - b._score[1] || a._score[2] - b._score[2]);
  return scored.map(({ _score, ...p }) => p);
}

export const pickupService = {
  /** Pickup points of each seller, nearest first. Sellers without pickup are left out. */
  async forVendors(vendorIds, near = {}) {
    const ids = vendorIds.filter((id) => mongoose.isValidObjectId(id));
    const vendors = await Vendor.find({ _id: { $in: ids }, status: 'approved', 'pickup.enabled': true })
      .select(PICKUP_FIELDS)
      .lean();
    return Object.fromEntries(vendors.map((v) => [String(v._id), rank(pickupPoints(v), near)]).filter(([, points]) => points.length));
  },

  /** Seller panel: their pickup settings and every warehouse, including switched-off ones. */
  async settings(vendorId) {
    const vendor = await Vendor.findById(vendorId).select(PICKUP_FIELDS).lean();
    if (!vendor) throw ApiError.notFound('Seller not found');
    return {
      enabled: Boolean(vendor.pickup?.enabled),
      includeMainAddress: vendor.pickup?.includeMainAddress !== false,
      hours: vendor.pickup?.hours ?? '',
      mainAddress: vendor.address ?? null,
      warehouses: (vendor.warehouses ?? []).map((w) => ({ ...w, _id: String(w._id) })),
      points: pickupPoints(vendor),
    };
  },

  /** Saves the settings and the whole warehouse list (rows keep their ids so placed orders still match them). */
  async save(vendorId, { enabled, includeMainAddress, hours, warehouses }) {
    const vendor = await Vendor.findById(vendorId);
    if (!vendor) throw ApiError.notFound('Seller not found');
    vendor.pickup = { enabled, includeMainAddress, hours: hours || undefined };
    vendor.warehouses = warehouses.map((w) => (w._id ? { ...w, _id: w._id } : w));
    if (enabled && !pickupPoints(vendor.toObject()).length) {
      throw ApiError.unprocessable('Add a pickup location, or keep your business address as one, to offer self pickup', {
        code: 'NO_PICKUP_POINTS',
      });
    }
    await vendor.save();
    return this.settings(vendorId);
  },

  /**
   * Checks the buyer's pickup choices against the cart's sellers. Returns { vendorId → point snapshot }.
   * @param {{ vendor: string, point: string }[]} choices
   */
  async resolve(choices, cartVendorIds) {
    if (!choices?.length) return new Map();
    const inCart = new Set(cartVendorIds.map(String));
    const offered = await this.forVendors(choices.map((c) => c.vendor));
    const out = new Map();
    for (const { vendor, point } of choices) {
      const match = inCart.has(String(vendor)) && offered[String(vendor)]?.find((p) => p._id === point);
      if (!match) {
        throw ApiError.unprocessable('That pickup location is no longer available. Please choose again.', {
          code: 'PICKUP_UNAVAILABLE',
          details: { vendor },
        });
      }
      const { distanceKm: _d, nearby: _n, main: _m, ...snapshot } = match;
      out.set(String(vendor), { pointId: point, ...snapshot });
    }
    return out;
  },
};
