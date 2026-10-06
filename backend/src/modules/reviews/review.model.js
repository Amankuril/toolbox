import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

/** published → visible on the product page; hidden → removed by an admin (kept for audit). */
export const REVIEW_STATUSES = ['published', 'hidden'];

/**
 * One review per customer per product, only from a customer whose order line for that
 * product was delivered (so every review is a verified purchase).
 */
const reviewSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    // When the item reached the customer: shown as "Verified purchase · Aug 2026".
    purchasedAt: Date,
    rating: { type: Number, required: true, min: 1, max: 5 },
    title: { type: String, trim: true, maxlength: 120 },
    body: { type: String, trim: true, maxlength: 2000 },
    status: { type: String, enum: REVIEW_STATUSES, default: 'published' },
    moderation: {
      note: { type: String, trim: true, maxlength: 500 },
      at: Date,
      by: { type: Schema.Types.ObjectId, ref: 'Admin' },
    },
  },
  baseOptions,
);

reviewSchema.index({ product: 1, user: 1 }, { unique: true });
reviewSchema.index({ product: 1, status: 1, createdAt: -1 });
reviewSchema.index({ product: 1, status: 1, rating: -1, createdAt: -1 });
reviewSchema.index({ status: 1, createdAt: -1 });

export const Review = mongoose.models.Review ?? mongoose.model('Review', reviewSchema);
