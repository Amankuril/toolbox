import mongoose, { Schema } from 'mongoose';
import { actorSchema } from '#core/db/schemas.js';

export const WALLET_REASONS = ['topup', 'admin_credit', 'admin_debit', 'order_payment', 'order_refund', 'order_release'];

/**
 * The wallet ledger: one row per balance change. `ref` makes each change happen once
 * (a retried refund or webhook finds the row and stops). Top-ups start pending until paid.
 */
const walletTxnSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: ['credit', 'debit'], required: true },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, enum: WALLET_REASONS, required: true },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
    balanceAfter: Number,
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    orderNumber: String,
    note: { type: String, trim: true, maxlength: 300 },
    by: actorSchema,
    ref: { type: String },
    // Top-ups: the gateway order and payment.
    providerOrderId: String,
    providerPaymentId: String,
  },
  { timestamps: true, versionKey: false },
);

walletTxnSchema.index({ user: 1, createdAt: -1 });
walletTxnSchema.index({ ref: 1 }, { unique: true, partialFilterExpression: { ref: { $type: 'string' } } });
walletTxnSchema.index({ providerOrderId: 1 }, { unique: true, partialFilterExpression: { providerOrderId: { $type: 'string' } } });

export const WalletTxn = mongoose.models.WalletTxn ?? mongoose.model('WalletTxn', walletTxnSchema);
