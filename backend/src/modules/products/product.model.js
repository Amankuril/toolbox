import mongoose, { Schema } from 'mongoose';
import { baseOptions, imageSchema } from '#core/db/schemas.js';

export const PRODUCT_TYPES = ['tool', 'machinery', 'part'];
export const PRODUCT_CONDITIONS = ['new', 'refurbished', 'used'];
export const GST_RATES = [0, 5, 12, 18, 28];
export const PRODUCT_UNITS = ['piece', 'set', 'pair', 'box', 'pack', 'kg', 'litre', 'metre', 'roll'];
/**
 * draft    → saved by vendor, never submitted
 * pending  → waiting for admin review
 * active   → live on the storefront (when vendor is approved)
 * rejected → admin asked for changes (moderation.note)
 * inactive → hidden by vendor or admin, previously approved
 * archived → soft-deleted; kept for order history and slug stability
 */
export const PRODUCT_STATUSES = ['draft', 'pending', 'active', 'rejected', 'inactive', 'archived'];
export const MAX_PRODUCT_IMAGES = 10;

const specSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    value: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { _id: false },
);

const productSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    // Denormalised so public queries never need a join: false when vendor isn't approved.
    vendorApproved: { type: Boolean, default: false },

    category: { type: Schema.Types.ObjectId, ref: 'Category', required: true },
    // category.ancestors + category — filtering by any ancestor finds products in all sub-categories.
    categoryPath: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },

    type: { type: String, enum: PRODUCT_TYPES, required: true },
    name: { type: String, required: true, trim: true, maxlength: 200 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    sku: { type: String, trim: true, maxlength: 64 },
    brand: { type: String, trim: true, maxlength: 80 },
    modelNumber: { type: String, trim: true, maxlength: 80 },
    shortDescription: { type: String, trim: true, maxlength: 500 },
    description: { type: String, trim: true, maxlength: 20_000 },
    images: {
      type: [imageSchema],
      default: [],
      validate: [(v) => v.length <= MAX_PRODUCT_IMAGES, `At most ${MAX_PRODUCT_IMAGES} images`],
    },

    // All money in paise.
    pricing: {
      mrp: { type: Number, required: true, min: 0 },
      price: { type: Number, required: true, min: 0 },
      gstRate: { type: Number, enum: GST_RATES, default: 18 },
    },
    hsnCode: { type: String, trim: true, maxlength: 8 },

    inventory: {
      stock: { type: Number, default: 0, min: 0 },
      moq: { type: Number, default: 1, min: 1 },
      maxOrderQty: { type: Number, min: 1 },
      unit: { type: String, enum: PRODUCT_UNITS, default: 'piece' },
    },

    specifications: { type: [specSchema], default: [] },
    condition: { type: String, enum: PRODUCT_CONDITIONS, default: 'new' },
    warranty: {
      months: { type: Number, min: 0, max: 240 },
      details: { type: String, trim: true, maxlength: 500 },
    },
    shipping: {
      weightKg: { type: Number, min: 0 },
      lengthCm: { type: Number, min: 0 },
      widthCm: { type: Number, min: 0 },
      heightCm: { type: Number, min: 0 },
      dispatchDays: { type: Number, min: 0, max: 60, default: 2 },
    },

    // Spare parts / accessories: the machines or tools they fit.
    compatibleWith: { type: [{ type: Schema.Types.ObjectId, ref: 'Product' }], default: [] },
    compatibleModels: { type: [{ type: String, trim: true, maxlength: 80 }], default: [] },
    tags: { type: [{ type: String, trim: true, lowercase: true, maxlength: 40 }], default: [] },

    status: { type: String, enum: PRODUCT_STATUSES, default: 'draft' },
    moderation: {
      note: { type: String, trim: true, maxlength: 1000 },
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
      approvedAt: Date,
    },
    isFeatured: { type: Boolean, default: false },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 320 },
    },
    publishedAt: Date,
  },
  baseOptions,
);

// Storefront listing: visible products in a category subtree, by recency / price.
productSchema.index({ status: 1, vendorApproved: 1, categoryPath: 1, publishedAt: -1 });
productSchema.index({ status: 1, vendorApproved: 1, 'pricing.price': 1 });
productSchema.index({ status: 1, vendorApproved: 1, isFeatured: 1, publishedAt: -1 });
productSchema.index({ vendor: 1, status: 1, updatedAt: -1 });
productSchema.index({ vendor: 1, sku: 1 }, { unique: true, partialFilterExpression: { sku: { $type: 'string' } } });
productSchema.index({ compatibleWith: 1 });
productSchema.index(
  { name: 'text', brand: 'text', modelNumber: 'text', tags: 'text', shortDescription: 'text' },
  { name: 'product_text', weights: { name: 10, brand: 6, modelNumber: 6, tags: 4, shortDescription: 1 }, default_language: 'english' },
);

export const Product = mongoose.models.Product ?? mongoose.model('Product', productSchema);
