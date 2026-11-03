import mongoose, { Schema } from 'mongoose';
import { baseOptions, imageSchema } from '#core/db/schemas.js';

/** Where a banner renders: the home page, or exit_intent = a pop-up offer when a visitor is about to leave. */
export const BANNER_PLACEMENTS = ['home_hero', 'home_offer', 'home_strip', 'exit_intent'];
export const BANNER_STATUSES = ['active', 'inactive'];

const bannerSchema = new Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 120 },
    subtitle: { type: String, trim: true, maxlength: 240 },
    ctaLabel: { type: String, trim: true, maxlength: 40 },
    link: { type: String, trim: true, maxlength: 500 },
    // Required for every placement except the hero, where a video can stand in for it.
    image: imageSchema,
    mobileImage: imageSchema,
    /** Hero only: an uploaded video that plays muted on a loop (the image, if any, is its poster). */
    video: imageSchema,
    /** Hero only: false = just the picture or video, no title, subtitle or buttons over it. */
    showText: { type: Boolean, default: true },
    placement: { type: String, enum: BANNER_PLACEMENTS, required: true },
    // Exit offers: the coupon the pop-up hands out (applied to the cart from the banner).
    coupon: { type: Schema.Types.ObjectId, ref: 'Coupon' },
    sortOrder: { type: Number, default: 0 },
    status: { type: String, enum: BANNER_STATUSES, default: 'active' },
    startsAt: Date,
    endsAt: Date,
  },
  baseOptions,
);

bannerSchema.index({ placement: 1, status: 1, sortOrder: 1 });

export const Banner = mongoose.models.Banner ?? mongoose.model('Banner', bannerSchema);
