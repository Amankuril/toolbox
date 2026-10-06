import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

/**
 * validated  → file parsed and checked; waiting for the vendor to confirm
 * queued     → confirmed; the background worker will pick it up
 * processing → worker is creating/updating products (resumable: done items are skipped)
 * completed  → every valid item was attempted (see counts for failures)
 * cancelled  → vendor discarded it before or during processing
 * failed     → the worker gave up (unexpected error); remaining items stay pending
 */
export const IMPORT_STATUSES = ['validated', 'queued', 'processing', 'completed', 'cancelled', 'failed'];
/** create: only add new products (a SKU that already exists is an error). upsert: update by SKU, add the rest. */
export const IMPORT_MODES = ['create', 'upsert'];
export const ITEM_STATUSES = ['invalid', 'pending', 'processing', 'created', 'updated', 'failed', 'skipped'];

const issueSchema = new Schema(
  {
    row: Number,
    column: String,
    message: { type: String, maxlength: 300 },
  },
  { _id: false },
);

const importSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    fileName: { type: String, trim: true, maxlength: 255 },
    mode: { type: String, enum: IMPORT_MODES, default: 'create' },
    status: { type: String, enum: IMPORT_STATUSES, default: 'validated' },
    counts: {
      rows: { type: Number, default: 0 },
      items: { type: Number, default: 0 },
      valid: { type: Number, default: 0 },
      invalid: { type: Number, default: 0 },
      created: { type: Number, default: 0 },
      updated: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    // Problems that aren't tied to one product (missing columns, unknown headers).
    fileIssues: { type: [issueSchema], default: [] },
    // Worker lease: whoever holds an unexpired lease is the only one processing this import.
    lease: { owner: String, until: Date },
    startedAt: Date,
    finishedAt: Date,
    error: { type: String, maxlength: 500 },
  },
  baseOptions,
);
importSchema.index({ vendor: 1, createdAt: -1 });
importSchema.index({ status: 1, 'lease.until': 1 });
// Unconfirmed uploads (and their items) are purged by the worker after a week.
importSchema.index({ status: 1, createdAt: 1 });

/** One product (a single row, or all rows of a handle). */
const importItemSchema = new Schema(
  {
    import: { type: Schema.Types.ObjectId, ref: 'ProductImport', required: true },
    index: { type: Number, required: true },
    rows: { type: [Number], default: [] },
    handle: String,
    name: String,
    sku: String,
    status: { type: String, enum: ITEM_STATUSES, required: true },
    // Validated product input (same shape the product API accepts), minus resolved images.
    input: Schema.Types.Mixed,
    imageUrls: { type: [String], default: [] },
    variantImageUrls: { type: [String], default: [] },
    issues: { type: [issueSchema], default: [] },
    product: { type: Schema.Types.ObjectId, ref: 'Product' },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true, versionKey: false },
);
importItemSchema.index({ import: 1, index: 1 }, { unique: true });
importItemSchema.index({ import: 1, status: 1, index: 1 });

export const ProductImport = mongoose.models.ProductImport ?? mongoose.model('ProductImport', importSchema);
export const ProductImportItem = mongoose.models.ProductImportItem ?? mongoose.model('ProductImportItem', importItemSchema);
