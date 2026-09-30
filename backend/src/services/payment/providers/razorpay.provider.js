import Razorpay from 'razorpay';
import { ApiError } from '#core/errors/ApiError.js';
import { hmacSha256, safeEqual } from '#core/utils/crypto.js';

export function createRazorpayProvider({ keyId, keySecret, webhookSecret }) {
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });

  const wrap = async (fn, message) => {
    try {
      return await fn();
    } catch (err) {
      throw ApiError.serviceUnavailable(message, { cause: err, code: 'PAYMENT_GATEWAY_ERROR' });
    }
  };

  return {
    name: 'razorpay',
    publicKey: keyId,

    /** @param {{ amount: number, currency: string, receipt: string, notes?: object }} input amount in paise */
    async createOrder({ amount, currency, receipt, notes }) {
      const order = await wrap(() => client.orders.create({ amount, currency, receipt, notes }), 'Could not start the payment. Please try again.');
      return { providerOrderId: order.id, amount: order.amount, currency: order.currency, status: order.status };
    },

    /** Signature returned to Checkout: HMAC_SHA256(order_id + "|" + payment_id, key_secret). */
    verifyCheckoutSignature({ providerOrderId, paymentId, signature }) {
      if (!providerOrderId || !paymentId || !signature) return false;
      return safeEqual(hmacSha256(keySecret, `${providerOrderId}|${paymentId}`), signature);
    },

    /** X-Razorpay-Signature: HMAC_SHA256(raw request body, webhook secret). */
    verifyWebhookSignature(rawBody, signature) {
      if (!webhookSecret || !signature) return false;
      return safeEqual(hmacSha256(webhookSecret, rawBody), signature);
    },

    async fetchPayment(paymentId) {
      const p = await wrap(() => client.payments.fetch(paymentId), 'Could not fetch payment status');
      return { id: p.id, orderId: p.order_id, status: p.status, amount: p.amount, method: p.method, captured: p.captured };
    },

    async refund(paymentId, { amount, notes } = {}) {
      const r = await wrap(() => client.payments.refund(paymentId, { ...(amount ? { amount } : {}), notes }), 'Refund failed');
      return { refundId: r.id, amount: r.amount, status: r.status };
    },
  };
}
