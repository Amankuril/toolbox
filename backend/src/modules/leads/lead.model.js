import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

export const MAX_LEAD_PRODUCTS = 10;

/** A signed-in buyer who tapped "Chat on WhatsApp" on one of a seller's products. One per (seller, buyer). */
const whatsappLeadSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    clicks: { type: Number, default: 0 },
    lastAt: { type: Date, required: true },
    // Most recent first, capped at MAX_LEAD_PRODUCTS.
    products: {
      type: [
        new Schema(
          {
            product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
            name: String,
            slug: String,
            image: String,
            at: { type: Date, default: Date.now },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  baseOptions,
);

whatsappLeadSchema.index({ vendor: 1, user: 1 }, { unique: true });
whatsappLeadSchema.index({ vendor: 1, lastAt: -1 });

export const WhatsappLead = mongoose.models.WhatsappLead ?? mongoose.model('WhatsappLead', whatsappLeadSchema);

export const CONTACT_CHANNELS = ['whatsapp', 'sms'];
export const CONTACT_KINDS = ['cart_reminder', 'follow_up', 'offer'];

/** A seller reaching out to a lead from the Leads page (shown as "Notification sent …"). */
const leadContactSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    channel: { type: String, enum: CONTACT_CHANNELS, required: true },
    kind: { type: String, enum: CONTACT_KINDS, required: true },
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    couponCode: String,
    // An admin acting as the house store, for the record.
    by: { type: Schema.Types.ObjectId },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

leadContactSchema.index({ vendor: 1, user: 1, createdAt: -1 });
// Contact history is only useful for a while.
leadContactSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180 });

export const LeadContact = mongoose.models.LeadContact ?? mongoose.model('LeadContact', leadContactSchema);
