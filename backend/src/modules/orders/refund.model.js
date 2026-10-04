import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

export const REFUND_STATUSES = ['pending', 'processed', 'failed'];

const refundModelSchema = new Schema(
  {
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    paymentId: { type: Schema.Types.ObjectId, ref: 'Payment' },
    itemId: { type: Schema.Types.ObjectId },
    provider: { type: String, default: 'razorpay', required: true },
    providerRefundId: String,
    providerPaymentId: { type: String, required: true },
    amount: { type: Number, required: true, min: 1 }, // in paise
    currency: { type: String, default: 'INR', required: true },
    status: { type: String, enum: REFUND_STATUSES, default: 'pending', required: true },
    reason: { type: String, trim: true, maxlength: 500 },
    idempotencyKey: { type: String, required: true },
    failureReason: String,
    processedAt: Date,
  },
  baseOptions,
);

refundModelSchema.index({ idempotencyKey: 1 }, { unique: true });
refundModelSchema.index({ orderId: 1, createdAt: -1 });
refundModelSchema.index({ paymentId: 1 });
refundModelSchema.index({ providerRefundId: 1 }, { partialFilterExpression: { providerRefundId: { $type: 'string' } } });
refundModelSchema.index({ status: 1, createdAt: -1 });

export const Refund = mongoose.models.Refund ?? mongoose.model('Refund', refundModelSchema);
