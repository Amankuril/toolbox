import mongoose, { Schema } from 'mongoose';
import { actorSchema, addressFields, baseOptions } from '#core/db/schemas.js';

export const ORDER_STATUSES = ['pending_payment', 'placed', 'processing', 'completed', 'cancelled'];
export const ITEM_STATUSES = ['pending', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'];
export const PAYMENT_METHODS = ['razorpay', 'cod'];
export const PAYMENT_STATUSES = ['pending', 'paid', 'failed', 'refunded', 'partially_refunded'];

/** Allowed fulfilment transitions per line item. */
export const ITEM_TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['packed', 'shipped', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  cancelled: [],
};

const historySchema = new Schema(
  {
    status: { type: String, enum: ITEM_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: actorSchema,
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

/** Line items snapshot product data at purchase time; later product edits don't rewrite history. */
const orderItemSchema = new Schema({
  product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
  name: { type: String, required: true },
  slug: String,
  sku: String,
  image: String,
  type: String,
  hsnCode: String,
  unitPrice: { type: Number, required: true, min: 0 },
  // The listed price at purchase; differs from unitPrice when a bulk tier or quote applied.
  basePrice: { type: Number, min: 0 },
  unitMrp: { type: Number, required: true, min: 0 },
  pricing: {
    source: { type: String, enum: ['base', 'bulk', 'quote'], default: 'base' },
    tierMinQty: Number,
    quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
  },
  gstRate: { type: Number, required: true },
  quantity: { type: Number, required: true, min: 1 },
  lineTotal: { type: Number, required: true, min: 0 },
  taxAmount: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ITEM_STATUSES, default: 'pending' },
  tracking: {
    carrier: { type: String, trim: true, maxlength: 80 },
    trackingNumber: { type: String, trim: true, maxlength: 80 },
    url: { type: String, trim: true, maxlength: 500 },
  },
  refunded: { type: Boolean, default: false },
  history: { type: [historySchema], default: [] },
});

const refundSchema = new Schema(
  {
    itemId: Schema.Types.ObjectId,
    amount: { type: Number, required: true },
    providerRefundId: String,
    status: String,
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

const orderSchema = new Schema(
  {
    orderNumber: { type: String, required: true, unique: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    items: { type: [orderItemSchema], required: true },
    // Distinct vendors on the order, for the vendor order list index.
    vendors: { type: [{ type: Schema.Types.ObjectId, ref: 'Vendor' }], default: [] },

    shippingAddress: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      ...addressFields,
    },
    billing: {
      name: String,
      businessName: String,
      gstin: String,
    },
    notes: { type: String, trim: true, maxlength: 500 },

    // All paise.
    amounts: {
      subtotal: { type: Number, required: true },
      tax: { type: Number, required: true },
      shipping: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      total: { type: Number, required: true },
      refunded: { type: Number, default: 0 },
    },

    payment: {
      method: { type: String, enum: PAYMENT_METHODS, required: true },
      status: { type: String, enum: PAYMENT_STATUSES, default: 'pending' },
      provider: String,
      providerOrderId: { type: String },
      providerPaymentId: String,
      paidAt: Date,
      failureReason: String,
    },
    refunds: { type: [refundSchema], default: [] },

    status: { type: String, enum: ORDER_STATUSES, required: true },
    // Unpaid online orders hold stock until this time, then the sweeper releases it.
    expiresAt: Date,
    cancelledAt: Date,
    cancelReason: { type: String, trim: true, maxlength: 500 },
  },
  baseOptions,
);

orderSchema.index({ user: 1, createdAt: -1 });
orderSchema.index({ vendors: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });
orderSchema.index(
  { 'payment.providerOrderId': 1 },
  { unique: true, partialFilterExpression: { 'payment.providerOrderId': { $type: 'string' } } },
);
orderSchema.index({ status: 1, expiresAt: 1 }, { partialFilterExpression: { status: 'pending_payment' } });

export const Order = mongoose.models.Order ?? mongoose.model('Order', orderSchema);

/** Webhook event log: guarantees each gateway event is processed once. */
const paymentEventSchema = new Schema(
  {
    provider: { type: String, required: true },
    eventId: { type: String, required: true },
    type: { type: String, required: true },
    providerOrderId: String,
    payload: Schema.Types.Mixed,
    processedAt: Date,
    error: String,
  },
  { timestamps: true, versionKey: false },
);
paymentEventSchema.index({ provider: 1, eventId: 1 }, { unique: true });
paymentEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 });

export const PaymentEvent = mongoose.models.PaymentEvent ?? mongoose.model('PaymentEvent', paymentEventSchema);
