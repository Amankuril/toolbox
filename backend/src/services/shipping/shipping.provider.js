import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';
import { settingsService } from '#services/settings/settings.service.js';
import { createShipmozoProvider } from './providers/shipmozo/shipmozo.provider.js';

/**
 * Provider registry. A provider exposes: info, serviceability, rates, pushOrder, pushReturnOrder,
 * orderExists, assignCourier, autoAssign, schedulePickup, cancel, track, label, returnReasons,
 * warehouses, createWarehouse, updateOrderWarehouse. Adding another courier aggregator means
 * implementing that interface and registering it here.
 */
let provider = env.shipmozoConfigured
  ? createShipmozoProvider({
      baseUrl: env.SHIPMOZO_BASE_URL,
      publicKey: env.SHIPMOZO_PUBLIC_KEY,
      privateKey: env.SHIPMOZO_PRIVATE_KEY,
      timeoutMs: env.SHIPMOZO_TIMEOUT_MS,
    })
  : null;

export const shippingProvider = {
  /** Active provider, or null when shipping integration is off or unconfigured. */
  async active() {
    if (!provider) return null;
    const { shipmozoEnabled } = await settingsService.get('shipping');
    return shipmozoEnabled ? provider : null;
  },

  async require() {
    const active = await this.active();
    if (!active) throw ApiError.unprocessable('Shipping integration is not enabled', { code: 'SHIPPING_DISABLED' });
    return active;
  },

  /** Test seam: swap in a fake provider. */
  useProvider(next) {
    provider = next;
  },
};
