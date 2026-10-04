import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

export const PAYMENT_STATES = [
  'created',
  'pending',
  'authorized',
  'captured',
  'failed',
  'cancelled',
  'refund_pending',
  'refunded',
  'partially_refunded',
];

/** Strict transition guards preventing invalid state jumps (e.g. failed -> captured). */
export const PAYMENT_TRANSITIONS = {
  created: ['pending', 'failed', 'cancelled'],
  pending: ['authorized', 'captured', 'failed', 'cancelled'],
  authorized: ['captured', 'failed'],
  captured: ['refund_pending', 'refunded', 'partially_refunded'],
  refund_pending: ['refunded', 'partially_refunded', 'failed'],
  failed: [],
  cancelled: [],
  refunded: [],
  partially_refunded: ['refund_pending', 'refunded'],
};

export function canTransitionPayment(from, to) {
  if (from === to) return true;
  return Boolean(PAYMENT_TRANSITIONS[from]?.includes(to));
}

const paymentSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    provider: { type: String, default: 'razorpay', required: true },
    providerOrderId: { type: String, required: true },
    providerPaymentId: String,
    providerSignature: String,
    attemptNumber: { type: Number, required: true, default: 1 },
    idempotencyKey: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 }, // in paise
    currency: { type: String, default: 'INR', required: true },
    status: { type: String, enum: PAYMENT_STATES, default: 'created', required: true },
    method: String,
    failureCode: String,
    failureReason: String,
    capturedAt: Date,
    failedAt: Date,
    cancelledAt: Date,
    signatureVerified: { type: Boolean, default: false },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  baseOptions,
);

paymentSchema.index({ orderId: 1, attemptNumber: 1 }, { unique: true });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true });
paymentSchema.index({ providerOrderId: 1 });
paymentSchema.index({ providerOrderId: 1, status: 1 });
paymentSchema.index({ providerPaymentId: 1 }, { partialFilterExpression: { providerPaymentId: { $type: 'string' } } });
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ status: 1, createdAt: -1 });

export const Payment = mongoose.models.Payment ?? mongoose.model('Payment', paymentSchema);
