import { logger } from '#config/logger.js';
import { redis } from '#config/redis.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { toApiError } from '#services/shipping/shipping.errors.js';
import { shippingProvider } from '#services/shipping/shipping.provider.js';
import { settingsService } from '#services/settings/settings.service.js';
import { computePackage } from './shipping.package.js';

const SERVICEABILITY_TTL_SECONDS = 6 * 60 * 60;

/** Pincode pairs rarely change serviceability; cache answers so storefront checks don't hammer Shipmozo. */
async function serviceable(provider, pickupPincode, deliveryPincode) {
  const key = `ship:svc:${pickupPincode}:${deliveryPincode}`;
  const hit = await redis.get(key).catch(() => null);
  if (hit !== null) return hit === '1';
  const { serviceable: ok } = await provider.serviceability({ pickupPincode, deliveryPincode });
  await redis.set(key, ok ? '1' : '0', 'EX', SERVICEABILITY_TTL_SECONDS).catch(() => {});
  return ok;
}

async function vendorPincodes(vendorIds) {
  const vendors = await Vendor.find({ _id: { $in: vendorIds } }, 'address.pincode store.name').lean();
  return new Map(vendors.map((v) => [String(v._id), { pincode: v.address?.pincode, storeName: v.store?.name }]));
}

/** Storefront / checkout-side shipping checks. All inputs that matter are read from the database. */
export const shippingQuotes = {
  /** Can this product be delivered to the pincode? `null` serviceable = unknown (integration off or provider down). */
  async productServiceability(productId, deliveryPincode) {
    const provider = await shippingProvider.active();
    if (!provider) return { serviceable: null };
    const product = await Product.findOne({ _id: productId, ...VISIBLE }, 'vendor').lean();
    if (!product) throw ApiError.notFound('Product not found');
    const { pincode } = (await vendorPincodes([product.vendor])).get(String(product.vendor)) ?? {};
    if (!pincode) return { serviceable: null };
    try {
      return { serviceable: await serviceable(provider, pincode, deliveryPincode) };
    } catch (err) {
      logger.warn({ err, productId }, 'Serviceability check failed');
      return { serviceable: null };
    }
  },

  /**
   * Checkout guard. Only blocks when the admin turned on `blockUnserviceable` and Shipmozo
   * positively says a seller can't reach the pincode; provider outages never block an order.
   */
  async assertCheckoutServiceable(vendorIds, deliveryPincode) {
    const { blockUnserviceable } = await settingsService.get('shipping');
    const provider = blockUnserviceable ? await shippingProvider.active() : null;
    if (!provider) return;

    const pins = await vendorPincodes(vendorIds);
    const blocked = [];
    for (const id of vendorIds) {
      const v = pins.get(String(id));
      if (!v?.pincode) continue;
      try {
        if (!(await serviceable(provider, v.pincode, deliveryPincode))) blocked.push({ vendor: id, store: v.storeName });
      } catch (err) {
        logger.warn({ err, vendor: id }, 'Serviceability check failed during checkout; allowing order');
      }
    }
    if (blocked.length) {
      throw ApiError.unprocessable(`Delivery to pincode ${deliveryPincode} is not available for some items in your cart.`, {
        code: 'PINCODE_NOT_SERVICEABLE',
        details: blocked,
      });
    }
  },

  /**
   * Indicative courier rates for the signed-in user's cart to one of their addresses.
   * Weight, size and value all come from the cart and product records on the server.
   */
  async cartQuote(cart, address, paymentMethod) {
    const provider = await shippingProvider.require();
    const { defaultPackage } = await settingsService.get('shipping');
    const groups = new Map();
    for (const i of cart.items) {
      const key = String(i._product.vendor);
      const g = groups.get(key) ?? { vendor: i._product.vendor, lines: [], amount: 0 };
      g.lines.push({ product: i._product._id, quantity: i.quantity });
      g.amount += i.lineTotal;
      groups.set(key, g);
    }
    const pins = await vendorPincodes([...groups.values()].map((g) => g.vendor));

    const sellers = [];
    for (const g of groups.values()) {
      const v = pins.get(String(g.vendor));
      const entry = { vendor: g.vendor, store: v?.storeName ?? null, serviceable: null, cheapest: null };
      if (v?.pincode) {
        try {
          entry.serviceable = await serviceable(provider, v.pincode, address.pincode);
          if (entry.serviceable) {
            const rates = await provider.rates({
              pickupPincode: v.pincode,
              deliveryPincode: address.pincode,
              paymentType: paymentMethod === 'cod' ? 'cod' : 'prepaid',
              shipmentType: 'forward',
              orderAmount: g.amount,
              codAmount: g.amount,
              package: await computePackage(g.lines, defaultPackage),
            });
            const best = rates.filter((r) => r.charge !== null).sort((a, b) => a.charge - b.charge)[0];
            entry.cheapest = best ? { courier: best.name, charge: best.charge, estimatedDelivery: best.estimatedDelivery } : null;
          }
        } catch (err) {
          throw toApiError(err, { audience: 'user', fallback: 'Could not fetch delivery estimates right now' });
        }
      }
      sellers.push(entry);
    }
    return { pincode: address.pincode, sellers, chargedShipping: cart.summary.shipping };
  },
};
