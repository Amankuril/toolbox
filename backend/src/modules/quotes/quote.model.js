import mongoose, { Schema } from 'mongoose';
import { actorSchema, baseOptions } from '#core/db/schemas.js';

/**
 * requested → quoted → accepted → ordered
 *     │          │         └──────→ expired   (validity passed before checkout)
 *     │          ├──→ rejected               (buyer said no)
 *     │          └──→ expired                (validity passed before the buyer answered)
 *     ├──→ declined                          (vendor can't supply)
 *     └──→ withdrawn                         (buyer cancelled before a quote / while quoted)
 */
export const QUOTE_STATUSES = ['requested', 'quoted', 'accepted', 'ordered', 'declined', 'rejected', 'withdrawn', 'expired'];
/** A buyer can only have one of these per product at a time. */
export const OPEN_QUOTE_STATUSES = ['requested', 'quoted', 'accepted'];
export const MAX_QUOTE_VALID_DAYS = 30;

const historySchema = new Schema(
  {
    status: { type: String, enum: QUOTE_STATUSES, required: true },
    at: { type: Date, default: Date.now },
    by: actorSchema,
    note: { type: String, trim: true, maxlength: 1000 },
  },
  { _id: false },
);

const quoteSchema = new Schema(
  {
    number: { type: String, required: true, unique: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },

    // What the buyer saw when asking, so the thread stays readable if the listing changes.
    productSnapshot: {
      name: String,
      slug: String,
      image: String,
      sku: String,
      unit: String,
      basePrice: Number,
      gstRate: Number,
    },

    // The request.
    quantity: { type: Number, required: true, min: 1 },
    targetUnitPrice: { type: Number, min: 1 },
    requiredBy: Date,
    pincode: { type: String, required: true, match: /^[1-9]\d{5}$/ },
    note: { type: String, trim: true, maxlength: 1000 },

    status: { type: String, enum: QUOTE_STATUSES, default: 'requested' },

    // The vendor's offer (paise per unit, GST inclusive like every other price).
    offer: {
      unitPrice: { type: Number, min: 1 },
      validUntil: Date,
      note: { type: String, trim: true, maxlength: 1000 },
      quotedAt: Date,
      revision: { type: Number, default: 0 },
    },
    declineReason: { type: String, trim: true, maxlength: 1000 },
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    history: { type: [historySchema], default: [] },
  },
  baseOptions,
);

quoteSchema.index({ user: 1, createdAt: -1 });
quoteSchema.index({ vendor: 1, status: 1, createdAt: -1 });
quoteSchema.index({ status: 1, 'offer.validUntil': 1 });
quoteSchema.index({ user: 1, product: 1, status: 1 });

export const Quote = mongoose.models.Quote ?? mongoose.model('Quote', quoteSchema);
