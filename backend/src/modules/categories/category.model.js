import mongoose, { Schema } from 'mongoose';
import { actorSchema, baseOptions, imageSchema } from '#core/db/schemas.js';
import { bumpOnWrite, catalogGeneration } from '#core/cache/cached.js';

/** Root (0) → sub (1) → leaf (2), mirroring the reference catalogue. */
export const MAX_CATEGORY_LEVEL = 2;
export const CATEGORY_STATUSES = ['active', 'pending', 'rejected', 'inactive'];

const categorySchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, trim: true, maxlength: 2000 },
    image: imageSchema,

    parent: { type: Schema.Types.ObjectId, ref: 'Category', default: null },
    // Materialised path, root first. Lets us fetch a subtree / breadcrumbs with one indexed query.
    ancestors: { type: [{ type: Schema.Types.ObjectId, ref: 'Category' }], default: [] },
    level: { type: Number, min: 0, max: MAX_CATEGORY_LEVEL, default: 0 },

    // null = platform category (admin). Otherwise the vendor who proposed it.
    owner: { type: Schema.Types.ObjectId, ref: 'Vendor', default: null },
    status: { type: String, enum: CATEGORY_STATUSES, default: 'active' },
    review: {
      note: { type: String, trim: true, maxlength: 500 },
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
    },

    sortOrder: { type: Number, default: 0 },
    isFeatured: { type: Boolean, default: false },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 320 },
    },
    createdBy: actorSchema,
  },
  baseOptions,
);

categorySchema.index({ parent: 1, sortOrder: 1, name: 1 });
categorySchema.index({ status: 1, level: 1 });
categorySchema.index({ ancestors: 1 });
categorySchema.index({ owner: 1, status: 1 });

// Cached public listings include these documents; any write retires them.
bumpOnWrite(categorySchema, catalogGeneration);

export const Category = mongoose.models.Category ?? mongoose.model('Category', categorySchema);
