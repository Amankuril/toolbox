import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';
import { settingsService } from '#services/settings/settings.service.js';
import { createRazorpayProvider } from './providers/razorpay.provider.js';

let razorpay = env.razorpayConfigured
  ? createRazorpayProvider({
      keyId: env.RAZORPAY_KEY_ID,
      keySecret: env.RAZORPAY_KEY_SECRET,
      webhookSecret: env.RAZORPAY_WEBHOOK_SECRET,
    })
  : null;

/**
 * Centralised payment service. Callers never touch a gateway SDK directly, so adding another
 * gateway means adding a provider here, not editing the order flow.
 */
export const paymentService = {
  /** Online gateway available for checkout right now (configured AND enabled by admin). */
  async onlineProvider() {
    const { razorpayEnabled } = await settingsService.get('payments');
    return razorpayEnabled && razorpay ? razorpay : null;
  },

  async requireOnlineProvider() {
    const provider = await this.onlineProvider();
    if (!provider) throw ApiError.unprocessable('Online payments are currently unavailable', { code: 'PAYMENT_UNAVAILABLE' });
    return provider;
  },

  /** Webhooks must verify even if an admin disabled checkout mid-flight, so bypass the toggle. */
  webhookProvider(name) {
    if (name === 'razorpay' && razorpay) return razorpay;
    return null;
  },

  /** Test seam. */
  useRazorpay(provider) {
    razorpay = provider;
  },
};
