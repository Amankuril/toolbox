import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Order } from '#modules/orders/order.model.js';
import { User } from '#modules/users/user.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { mailService } from '#services/mail/mail.service.js';
import { orderConfirmationEmail } from '#services/mail/templates.js';
import { settingsService } from '#services/settings/settings.service.js';
import { paymentBreakdown, renderConfirmationPdf } from './confirmation.pdf.js';
import { brandForPdf } from './pdf.kit.js';

/** Orders the buyer has a confirmed order for: paid, COD, or entered from a panel. */
const CONFIRMED = ['placed', 'processing', 'completed'];
const MAX_ATTEMPTS = 5;
const RETRY_AFTER_MS = 5 * 60_000;
// A send that never reported back (crashed instance) is retried after this.
const STUCK_AFTER_MS = 10 * 60_000;
// The sweeper only looks this far back, so turning the feature on never mails the order history.
const LOOKBACK_MS = 24 * 60 * 60_000;

const filenameFor = (order) => `Order-${order.orderNumber}.pdf`;

async function sellersOf(order) {
  const ids = [...new Set(order.items.map((i) => String(i.vendor)))];
  const vendors = await Vendor.find({ _id: { $in: ids } }, 'store.name business.legalName business.gstin').lean();
  return new Map(vendors.map((v) => [String(v._id), { name: v.store?.name || v.business?.legalName, gstin: v.business?.gstin }]));
}

async function render(order) {
  return renderConfirmationPdf(order, await sellersOf(order));
}

/** Orders still owed a confirmation email (never tried, failed earlier, or stuck mid-send). */
function dueFilter(now) {
  return {
    status: { $in: CONFIRMED },
    $or: [
      { 'confirmationEmail.status': { $exists: false } },
      {
        'confirmationEmail.status': 'failed',
        'confirmationEmail.attempts': { $lt: MAX_ATTEMPTS },
        'confirmationEmail.at': { $lt: new Date(now - RETRY_AFTER_MS) },
      },
      { 'confirmationEmail.status': 'sending', 'confirmationEmail.at': { $lt: new Date(now - STUCK_AFTER_MS) } },
    ],
  };
}

async function finish(orderId, status, error) {
  await Order.updateOne(
    { _id: orderId },
    {
      $set: {
        'confirmationEmail.status': status,
        'confirmationEmail.at': new Date(),
        ...(error ? { 'confirmationEmail.error': String(error).slice(0, 300) } : {}),
      },
    },
  );
}

export const confirmationService = {
  /**
   * The order confirmation PDF. Buyers get only their own orders.
   * @returns {Promise<{ filename: string, pdf: Buffer }>}
   */
  async pdf(orderId, scope = {}) {
    const order = await Order.findOne({ _id: orderId, ...(scope.userId ? { user: scope.userId } : {}) }).lean();
    if (!order) throw ApiError.notFound('Order not found');
    if (order.status === 'pending_payment') {
      throw ApiError.conflict('The order confirmation is available once the payment goes through.', { code: 'ORDER_NOT_CONFIRMED' });
    }
    return { filename: filenameFor(order), pdf: await render(order) };
  },

  /**
   * Emails the buyer their order confirmation with the PDF, once per order. Safe to call from anywhere and
   * more than once: the order is claimed atomically, so two callers never both send. Never throws.
   * @returns {Promise<'sent'|'skipped'|'failed'|null>} null when there was nothing to do
   */
  async send(orderId) {
    const now = Date.now();
    const order = await Order.findOneAndUpdate(
      { _id: orderId, ...dueFilter(now) },
      { $set: { 'confirmationEmail.status': 'sending', 'confirmationEmail.at': new Date(now) }, $inc: { 'confirmationEmail.attempts': 1 } },
      { returnDocument: 'after' },
    ).lean();
    if (!order) return null;

    try {
      const user = await User.findById(order.user, 'email').lean();
      if (!user?.email) {
        await finish(order._id, 'skipped', 'Buyer has no email address');
        return 'skipped';
      }
      if (!mailService.enabled) {
        await finish(order._id, 'skipped', 'Email sending is not configured');
        return 'skipped';
      }

      const [pdf, brand, branding] = await Promise.all([render(order), brandForPdf(), settingsService.get('branding')]);
      const isJpeg = brand.logo[0] === 0xff && brand.logo[1] === 0xd8;
      const message = orderConfirmationEmail({
        app: branding.siteName,
        order,
        orderUrl: `${env.PUBLIC_APP_URL}/account/orders/${order._id}`,
        payments: paymentBreakdown(order),
        logoCid: 'brand-logo',
        support: [branding.supportEmail, branding.supportPhone].filter(Boolean).join(' · '),
      });
      await mailService.send({
        to: user.email,
        ...message,
        attachments: [
          { filename: filenameFor(order), content: pdf, contentType: 'application/pdf' },
          {
            filename: isJpeg ? 'logo.jpg' : 'logo.png',
            content: brand.logo,
            contentType: isJpeg ? 'image/jpeg' : 'image/png',
            cid: 'brand-logo',
          },
        ],
      });
      await finish(order._id, 'sent');
      logger.info({ orderId: order._id, orderNumber: order.orderNumber }, 'Order confirmation emailed');
      return 'sent';
    } catch (err) {
      logger.warn({ err, orderId: order._id }, 'Order confirmation email failed; will retry');
      await finish(order._id, 'failed', err.cause?.message ?? err.message).catch(() => {});
      return 'failed';
    }
  },

  /** Admin: send the email again (e.g. the buyer added an email address later). */
  async resend(orderId) {
    const order = await Order.findOneAndUpdate(
      { _id: orderId, status: { $in: CONFIRMED }, 'confirmationEmail.status': { $ne: 'sending' } },
      { $unset: { confirmationEmail: 1 } },
    ).lean();
    if (!order) {
      const exists = await Order.exists({ _id: orderId });
      if (!exists) throw ApiError.notFound('Order not found');
      throw ApiError.conflict('This order is not confirmed yet, or its email is being sent right now.', { code: 'ORDER_NOT_CONFIRMED' });
    }
    const result = await this.send(orderId);
    const latest = await Order.findById(orderId, 'confirmationEmail').lean();
    if (result !== 'sent') {
      throw ApiError.unprocessable(`The email was not sent: ${latest?.confirmationEmail?.error ?? 'unknown error'}.`, {
        code: 'EMAIL_NOT_SENT',
      });
    }
    return latest.confirmationEmail;
  },

  /** Fire-and-forget send right after an order is confirmed; the sweeper retries anything that fails. */
  sendSoon(orderId) {
    setImmediate(() => {
      this.send(orderId).catch((err) => logger.error({ err, orderId }, 'Order confirmation email crashed'));
    });
  },

  /** Background job: sends every recent confirmed order still owed its email. */
  async sweep(limit = 25) {
    const now = Date.now();
    const due = await Order.find({ ...dueFilter(now), createdAt: { $gte: new Date(now - LOOKBACK_MS) } }, '_id')
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
    let sent = 0;
    for (const { _id } of due) {
      if ((await this.send(_id)) === 'sent') sent += 1;
    }
    return sent;
  },
};
