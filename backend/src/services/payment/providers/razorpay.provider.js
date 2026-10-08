import Razorpay from 'razorpay';
import { ApiError } from '#core/errors/ApiError.js';
import { hmacSha256, safeEqual } from '#core/utils/crypto.js';

const TIMEOUT_MS = 20_000;

export function createRazorpayProvider({ keyId, keySecret, webhookSecret }) {
  const client = new Razorpay({ key_id: keyId, key_secret: keySecret });

  // The SDK sets no request timeout; a hung gateway call would otherwise stall checkout or a job tick indefinitely.
  const wrap = async (fn, message) => {
    let timer;
    try {
      return await Promise.race([
        fn(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Razorpay request timed out after ${TIMEOUT_MS}ms`)), TIMEOUT_MS);
        }),
      ]);
    } catch (err) {
      throw ApiError.serviceUnavailable(message, { cause: err, code: 'PAYMENT_GATEWAY_ERROR' });
    } finally {
      clearTimeout(timer);
    }
  };

  return {
    name: 'razorpay',
    publicKey: keyId,

    /** @param {{ amount: number, currency: string, receipt: string, notes?: object }} input amount in paise */
    async createOrder({ amount, currency, receipt, notes }) {
      const order = await wrap(
        () => client.orders.create({ amount, currency, receipt, notes }),
        'Could not start the payment. Please try again.',
      );
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

    async fetchOrderPayments(providerOrderId) {
      if (!client.orders?.fetchPayments) return [];
      const res = await wrap(() => client.orders.fetchPayments(providerOrderId), 'Could not fetch order payments');
      return (res?.items || []).map((p) => ({
        id: p.id,
        orderId: p.order_id,
        status: p.status,
        amount: p.amount,
        method: p.method,
        captured: p.captured,
      }));
    },
  };
}
