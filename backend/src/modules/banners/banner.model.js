import mongoose, { Schema } from 'mongoose';
import { baseOptions, imageSchema } from '#core/db/schemas.js';

/** Where a banner renders on the storefront home page. */
export const BANNER_PLACEMENTS = ['home_hero', 'home_offer', 'home_strip'];
export const BANNER_STATUSES = ['active', 'inactive'];

const bannerSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 240 },
    ctaLabel: { type: String, trim: true, maxlength: 40 },
    link: { type: String, trim: true, maxlength: 500 },
    image: { type: imageSchema, required: true },
    mobileImage: imageSchema,
    placement: { type: String, enum: BANNER_PLACEMENTS, required: true },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: BANNER_STATUSES, default: 'active' },
    startsAt: Date,
    endsAt: Date,
  },
  baseOptions,
);

bannerSchema.index({ placement: 1, status: 1, sortOrder: 1 });

export const Banner = mongoose.models.Banner ?? mongoose.model('Banner', bannerSchema);
