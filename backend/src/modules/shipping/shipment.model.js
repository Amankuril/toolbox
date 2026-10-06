import mongoose, { Schema } from 'mongoose';
import { actorSchema, baseOptions } from '#core/db/schemas.js';

/**
 * pending            → planned locally, not yet accepted by the provider (also: push failed, retryable)
 * created            → provider accepted the order (push-order / push-return-order)
 * courier_assigned   → courier chosen; may still need schedule-pickup
 * pickup_scheduled   → schedule-pickup succeeded (AWB/LR issued)
 * pickup_pending     → courier will collect (from tracking, or auto-scheduled pickups)
 * picked_up / in_transit / out_for_delivery / delivered
 * exception          → courier reported a failed attempt / problem; still tracked
 * return_in_transit  → RTO on its way back to the seller
 * returned           → RTO completed
 * cancelled          → cancelled with the provider (or discarded before a courier was assigned)
 */
export const SHIPMENT_STATUSES = [
  'pending',
  'created',
  'courier_assigned',
  'pickup_scheduled',
  'pickup_pending',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
  'exception',
  'return_in_transit',
  'returned',
  'cancelled',
];
export const TERMINAL_SHIPMENT_STATUSES = ['delivered', 'returned', 'cancelled'];
/** Shipments the courier hasn't collected yet; these can still be cancelled. */
export const PRE_PICKUP_STATUSES = ['created', 'courier_assigned', 'pickup_scheduled', 'pickup_pending'];
/** Statuses tracking sync keeps polling. */
export const TRACKABLE_STATUSES = ['courier_assigned', 'pickup_scheduled', 'pickup_pending', 'picked_up', 'in_transit', 'out_for_delivery', 'exception', 'return_in_transit'];
export const SHIPMENT_TYPES = ['forward', 'return'];

const packageSchema = new Schema(
  { weightGrams: Number, lengthCm: Number, widthCm: Number, heightCm: Number },
  { _id: false },
);

const historySchema = new Schema(
  {
    status: { type: String, enum: SHIPMENT_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: actorSchema,
    note: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false },
);

const rateQuoteSchema = new Schema(
  {
    courierId: { type: Number, required: true },
    name: String,
    service: String,
    charge: Number,
    estimatedDelivery: String,
    pickupsAutomaticallyScheduled: Boolean,
  },
  { _id: false },
);

const shipmentSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    orderNumber: { type: String, required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    type: { type: String, enum: SHIPMENT_TYPES, default: 'forward' },
    // Return shipments point at the forward shipment they reverse.
    parent: { type: Schema.Types.ObjectId, ref: 'Shipment' },
    // Re-shipping after a cancellation creates a new attempt with a new provider order id.
    attempt: { type: Number, default: 1 },
    // Exactly one active shipment per (order, vendor, type) — see indexes.
    active: { type: Boolean, default: true },

    provider: { type: String, required: true },
    providerOrderId: { type: String, required: true },
    referenceId: String,
    warehouseId: String,

    items: [{ itemId: { type: Schema.Types.ObjectId, required: true }, quantity: { type: Number, required: true }, _id: false }],
    paymentType: { type: String, enum: ['prepaid', 'cod'], required: true },
    // Paise; only set for COD.
    codAmount: Number,
    package: packageSchema,

    status: { type: String, enum: SHIPMENT_STATUSES, default: 'pending' },
    courier: {
      id: Number,
      name: String,
      service: String,
    },
    awbNumber: String,
    lrNumber: String,
    pickupsAutomaticallyScheduled: Boolean,

    rateQuotes: { type: [rateQuoteSchema], default: undefined },
    ratesFetchedAt: Date,

    tracking: {
      currentStatus: String,
      statusTime: String,
      expectedDeliveryDate: String,
      scans: { type: [{ status: String, location: String, at: String, _id: false }], default: undefined },
      lastSyncedAt: Date,
    },

    returnInfo: {
      reasonId: Number,
      reasonTitle: String,
      customerRequest: String,
      comment: String,
    },

    pushedAt: Date,
    courierAssignedAt: Date,
    pickupScheduledAt: Date,
    pickedUpAt: Date,
    deliveredAt: Date,
    cancelledAt: Date,

    // In-flight provider call; claimed atomically so concurrent requests/jobs can't double-book.
    lock: { operation: String, at: Date },
    // A push timed out: Shipmozo may have the order. Verified via get-order-detail before any retry.
    needsVerification: { type: Boolean, default: false },
    failedAttempts: { type: Number, default: 0 },
    lastError: { operation: String, message: String, at: Date },

    history: { type: [historySchema], default: [] },
  },
  baseOptions,
);

shipmentSchema.index({ order: 1, createdAt: 1 });
shipmentSchema.index({ providerOrderId: 1 }, { unique: true });
shipmentSchema.index(
  { order: 1, vendor: 1, type: 1 },
  { unique: true, partialFilterExpression: { active: true, type: 'forward' }, name: 'one_active_forward_per_vendor' },
);
shipmentSchema.index({ parent: 1 }, { unique: true, partialFilterExpression: { active: true, type: 'return' }, name: 'one_active_return_per_parent' });
shipmentSchema.index({ status: 1, 'tracking.lastSyncedAt': 1 });
shipmentSchema.index({ awbNumber: 1 }, { sparse: true });

export const Shipment = mongoose.models.Shipment ?? mongoose.model('Shipment', shipmentSchema);
