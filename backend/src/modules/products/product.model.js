import mongoose, { Schema } from 'mongoose';
import { baseOptions, imageSchema } from '#core/db/schemas.js';
import { bumpOnWrite, catalogGeneration } from '#core/cache/cached.js';

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
/** Quantity price breaks on top of the base selling price (Amazon Business allows 5 as well). */
export const MAX_BULK_TIERS = 5;
/** Variant options (Size, Colour…) and the combinations they produce, Shopify-style. */
export const MAX_VARIANT_OPTIONS = 3;
export const MAX_OPTION_VALUES = 20;
export const MAX_VARIANTS = 100;

const specSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 80 },
    value: { type: String, required: true, trim: true, maxlength: 300 },
  },
  { _id: false },
);

/** "Buy minQty or more at price per unit" (paise). */
const bulkTierSchema = new Schema(
  {
    minQty: { type: Number, required: true, min: 2 },
    price: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

const variantOptionSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 40 },
    values: { type: [{ type: String, trim: true, maxlength: 60 }], default: [] },
  },
  { _id: false },
);

/** One sellable combination, e.g. Size "XL" + Colour "Red". `options` follows variantOptions order. */
const variantSchema = new Schema({
  options: { type: [{ type: String, trim: true, maxlength: 60 }], required: true },
  price: { type: Number, required: true, min: 0 },
  mrp: { type: Number, required: true, min: 0 },
  sku: { type: String, trim: true, maxlength: 64 },
  barcode: { type: String, trim: true, maxlength: 14 },
  stock: { type: Number, default: 0, min: 0 },
  available: { type: Boolean, default: true },
  weightKg: { type: Number, min: 0 },
  image: imageSchema,
});

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
    // GTIN family: UPC (12), EAN (8/13), GTIN-14, ISBN (10/13).
    barcode: { type: String, trim: true, maxlength: 14 },
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
      // Off: no count is kept; `available` alone decides whether it can be bought.
      trackQuantity: { type: Boolean, default: true },
      // Vendor's on/off switch from the product list; off makes it unavailable whatever the stock.
      available: { type: Boolean, default: true },
      // With variants this is the sum of variant stock (kept in sync on save).
      stock: { type: Number, default: 0, min: 0 },
      // Show buyers "Only N left" when tracked stock is at or below the threshold.
      lowStockAlert: { type: Boolean, default: false },
      lowStockThreshold: { type: Number, default: 5, min: 1 },
      moq: { type: Number, default: 1, min: 1 },
      maxOrderQty: { type: Number, min: 1 },
      unit: { type: String, enum: PRODUCT_UNITS, default: 'piece' },
    },

    variantOptions: { type: [variantOptionSchema], default: [] },
    variants: { type: [variantSchema], default: [] },

    // Quantity discounts: the deepest tier the cart quantity reaches sets the unit price.
    bulkPricing: {
      tiers: {
        type: [bulkTierSchema],
        default: [],
        validate: [(v) => v.length <= MAX_BULK_TIERS, `At most ${MAX_BULK_TIERS} bulk tiers`],
      },
      // Like Amazon Business: tiers only for buyers with a business account.
      businessOnly: { type: Boolean, default: false },
    },
    // Request-for-quote for quantities beyond the published tiers.
    quotes: {
      enabled: { type: Boolean, default: true },
      minQty: { type: Number, min: 1 },
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
    // Denormalised from published reviews (see review.service.js); breakdown[0] = 1-star count … [4] = 5-star.
    rating: {
      average: { type: Number, default: 0 },
      count: { type: Number, default: 0 },
      breakdown: { type: [Number], default: () => [0, 0, 0, 0, 0] },
    },
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
// Product page "similar items" (category + sort), and re-pathing products when a category moves.
productSchema.index({ category: 1, status: 1, vendorApproved: 1, isFeatured: -1, publishedAt: -1 });
// Product page "more from this seller", sorted without loading all of the seller's listings.
productSchema.index({ vendor: 1, status: 1, 'rating.count': -1, publishedAt: -1 });
productSchema.index(
  { name: 'text', brand: 'text', modelNumber: 'text', compatibleModels: 'text', tags: 'text', shortDescription: 'text' },
  {
    name: 'product_text',
    // compatibleModels lets the parts finder match "GSB 550" to spares that fit it.
    weights: { name: 10, brand: 6, modelNumber: 6, compatibleModels: 6, tags: 4, shortDescription: 1 },
    default_language: 'english',
  },
);

// Cached public listings include these documents; any write retires them.
bumpOnWrite(productSchema, catalogGeneration);

export const Product = mongoose.models.Product ?? mongoose.model('Product', productSchema);
