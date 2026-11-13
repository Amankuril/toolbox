import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { withLock } from '#core/utils/lock.js';
import { walletService } from '#modules/wallet/wallet.service.js';
import { paymentService } from '#services/payment/payment.service.js';
import { Order } from './order.model.js';
import { onlineAmount, PAID_ONLINE } from './partialPayment.js';

const CASH_SETTLED = ['paid', 'partially_refunded', 'refunded'];

/** What the lines still going ahead (and their delivery) cost the buyer. */
const stillOwed = (order) => {
  const active = order.items.filter((i) => i.status !== 'cancelled');
  return active.length ? active.reduce((s, i) => s + i.lineTotal, 0) + order.amounts.shipping : 0;
};

/** Everything already given back: gateway refunds, wallet returns on cancellation, and manual refunds. */
export const refundedSoFar = (order) =>
  (order.amounts.refunded ?? 0) + (order.amounts.walletRefunded ?? 0) + (order.amounts.manualRefunded ?? 0);

/**
 * Money in and out of an order, for the admin refund dialog. All paise.
 * - paid: wallet + online + cash actually received
 * - refundable: the most that can still be refunded
 * - suggested: what's owed back for cancelled lines (paid beyond what the remaining lines cost)
 * - gatewayRefundable: the part that can go back to the original card/UPI
 */
export function refundSummary(order) {
  const { amounts: a, payment } = order;
  const wallet = a.wallet ?? 0;
  const owed = stillOwed(order);
  const onlineSettled = ['razorpay', 'partial'].includes(payment.method) && PAID_ONLINE.includes(payment.status);
  const online = onlineSettled ? onlineAmount(order) : 0;
  let cash = 0;
  if (['cod', 'partial'].includes(payment.method) && CASH_SETTLED.includes(payment.status)) {
    cash = payment.cashCollected?.amount ?? Math.max(0, owed - wallet - (payment.method === 'partial' ? (a.advance ?? 0) : 0));
  }
  if (payment.method === 'offline' && CASH_SETTLED.includes(payment.status)) cash = a.total - wallet;

  const paid = wallet + online + cash;
  const refunded = refundedSoFar(order);
  const refundable = Math.max(0, paid - refunded);
  return {
    paid,
    refunded,
    refundable,
    suggested: Math.min(refundable, Math.max(0, paid - refunded - owed)),
    gatewayRefundable: payment.providerPaymentId ? Math.max(0, Math.min(refundable, online - (a.refunded ?? 0))) : 0,
  };
}

/**
 * An admin refunds an order by hand, any amount up to what's refundable.
 * @param {{ amount: number, method: 'gateway'|'wallet'|'offline', note?: string }} body
 */
export function manualRefund(orderId, { amount, method, note }, actor) {
  return withLock(
    `order:${orderId}`,
    async () => {
      const order = await Order.findById(orderId);
      if (!order) throw ApiError.notFound('Order not found');
      if (order.status === 'pending_payment') throw ApiError.conflict('This order is still awaiting payment', { code: 'AWAITING_PAYMENT' });

      const summary = refundSummary(order);
      if (amount > summary.refundable) {
        throw ApiError.unprocessable(`At most ₹${(summary.refundable / 100).toFixed(2)} can be refunded on this order.`, {
          code: 'REFUND_TOO_LARGE',
        });
      }
      if (method === 'gateway' && amount > summary.gatewayRefundable) {
        throw ApiError.unprocessable(
          summary.gatewayRefundable
            ? `At most ₹${(summary.gatewayRefundable / 100).toFixed(2)} can go back to the original payment. Refund the rest to the wallet or offline.`
            : 'This order has no online payment to refund to. Refund to the wallet or offline instead.',
          { code: 'REFUND_TOO_LARGE' },
        );
      }

      const n = order.refunds.length + 1;
      const entry = { amount, manual: true, method, note, by: actor, at: new Date() };
      if (method === 'gateway') {
        const refund = await paymentService.processRefund({
          order,
          amount,
          reason: note || 'Refund by admin',
          idempotencyKey: `manual_refund_${order._id}_${n}`,
        });
        order.amounts.refunded += refund.amount;
        Object.assign(entry, { providerRefundId: refund.providerRefundId, status: refund.status });
      } else {
        if (method === 'wallet') {
          await walletService.credit(order.user, amount, {
            reason: 'order_refund',
            order,
            note: note || `Refund for order ${order.orderNumber}`,
            by: actor,
            ref: `order:${order._id}:manual:${n}`,
          });
        }
        order.amounts.manualRefunded = (order.amounts.manualRefunded ?? 0) + amount;
        entry.status = 'processed';
      }
      order.refunds.push(entry);

      const after = refundedSoFar(order);
      if (after >= summary.paid) order.payment.status = 'refunded';
      else if (['paid', 'partially_refunded'].includes(order.payment.status)) order.payment.status = 'partially_refunded';
      await order.save();
      logger.info({ orderId: order._id, amount, method, by: actor }, 'Manual refund');
      return order;
    },
    { waitMs: 15_000 },
  );
}
