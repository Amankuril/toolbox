import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

/** open → new; contacted → the seller or admin got in touch; closed → done (sold, or not coming back). */
export const ENQUIRY_STATUSES = ['open', 'contacted', 'closed'];

/** A buyer asking about a product that's out of stock: when it's back, or whether they can still get it. */
const enquirySchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    // Snapshot, so the list still reads well if the product changes.
    productName: String,
    productSlug: String,
    productImage: String,
    variant: { id: Schema.Types.ObjectId, title: String },
    // Signed-in buyers are linked; guests leave a name and number.
    user: { type: Schema.Types.ObjectId, ref: 'User' },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    phone: { type: String, required: true, trim: true },
    quantity: { type: Number, min: 1, default: 1 },
    message: { type: String, trim: true, maxlength: 1000 },
    status: { type: String, enum: ENQUIRY_STATUSES, default: 'open' },
    contactedAt: Date,
  },
  baseOptions,
);

enquirySchema.index({ vendor: 1, status: 1, createdAt: -1 });
enquirySchema.index({ status: 1, createdAt: -1 });
enquirySchema.index({ product: 1, phone: 1, status: 1 });

export const Enquiry = mongoose.models.Enquiry ?? mongoose.model('Enquiry', enquirySchema);
