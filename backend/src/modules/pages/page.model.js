import mongoose, { Schema } from 'mongoose';
import { actorSchema, baseOptions } from '#core/db/schemas.js';

/**
 * The storefront's fixed information pages, written by admins. `slug` is the public address (/pages/:slug).
 * Content is plain text with light formatting (see frontend ui/RichText.jsx): "## " headings, "- " lists, **bold**.
 */
export const CONTENT_PAGES = [
  { key: 'terms', slug: 'terms-and-conditions', title: 'Terms & Conditions' },
  { key: 'privacy', slug: 'privacy-policy', title: 'Privacy Policy' },
  { key: 'cancellation', slug: 'cancellation-policy', title: 'Cancellation & Refund Policy' },
  { key: 'support', slug: 'support', title: 'Help & Support' },
];
export const PAGE_KEYS = CONTENT_PAGES.map((p) => p.key);
export const MAX_PAGE_LENGTH = 50_000;

const contentPageSchema = new Schema(
  {
    key: { type: String, enum: PAGE_KEYS, required: true, unique: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    content: { type: String, trim: true, maxlength: MAX_PAGE_LENGTH, default: '' },
    published: { type: Boolean, default: true },
    seo: {
      title: { type: String, trim: true, maxlength: 160 },
      description: { type: String, trim: true, maxlength: 320 },
    },
    updatedBy: actorSchema,
  },
  baseOptions,
);

export const ContentPage = mongoose.models.ContentPage ?? mongoose.model('ContentPage', contentPageSchema);
