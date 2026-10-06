import mongoose, { Schema } from 'mongoose';
import { addressSchema, baseOptions, imageSchema } from '#core/db/schemas.js';

/**
 * onboarding     → account created after OTP, wizard not yet submitted
 * pending_review → submitted, waiting for an admin
 * approved       → can list products; products are publicly visible
 * rejected       → admin asked for changes (see review.note); vendor can resubmit
 * suspended      → blocked from logging in; products hidden
 */
export const VENDOR_STATUSES = ['onboarding', 'pending_review', 'approved', 'rejected', 'suspended'];
export const BUSINESS_TYPES = ['proprietorship', 'partnership', 'llp', 'private_limited', 'public_limited', 'other'];
export const VENDOR_DOCUMENT_TYPES = ['gst_certificate', 'pan_card', 'cancelled_cheque', 'business_proof', 'other'];
export const ONBOARDING_STEPS = ['business', 'address', 'bank', 'documents'];

const documentSchema = new Schema(
  {
    type: { type: String, enum: VENDOR_DOCUMENT_TYPES, required: true },
    media: { type: Schema.Types.ObjectId, ref: 'Media', required: true },
    url: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const vendorSchema = new Schema(
  {
    phone: { type: String, required: true, unique: true, trim: true },
    // The marketplace's own store, run by admins from the admin panel (see modules/store). Never signs in.
    isPlatform: { type: Boolean },
    contactName: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, trim: true, lowercase: true },
    // Set when the email was proven by a sign-in code; cleared if the email changes.
    emailVerifiedAt: Date,
    status: { type: String, enum: VENDOR_STATUSES, default: 'onboarding' },

    store: {
      name: { type: String, required: true, trim: true, maxlength: 120 },
      slug: { type: String, trim: true, lowercase: true },
      description: { type: String, trim: true, maxlength: 2000 },
      logo: imageSchema,
    },

    business: {
      legalName: { type: String, trim: true, maxlength: 200 },
      type: { type: String, enum: BUSINESS_TYPES },
      gstin: { type: String, trim: true, uppercase: true },
      pan: { type: String, trim: true, uppercase: true },
      yearEstablished: { type: Number, min: 1900 },
    },

    address: addressSchema,

    bank: {
      accountHolderName: { type: String, trim: true, maxlength: 120 },
      // AES-256-GCM ciphertext; never selected by default and never returned to clients.
      accountNumberEnc: { type: String, select: false },
      accountNumberLast4: { type: String, trim: true },
      ifsc: { type: String, trim: true, uppercase: true },
      bankName: { type: String, trim: true, maxlength: 120 },
      branch: { type: String, trim: true, maxlength: 120 },
    },

    documents: { type: [documentSchema], default: [] },

    // Pickup location registered with the shipping provider (Shipmozo warehouse id).
    shipping: {
      warehouseId: { type: String, trim: true },
      warehouseSyncedAt: Date,
    },

    onboarding: {
      completedSteps: { type: [String], enum: ONBOARDING_STEPS, default: [] },
      submittedAt: Date,
    },

    review: {
      reviewedAt: Date,
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'Admin' },
      note: { type: String, trim: true, maxlength: 1000 },
    },

    lastLoginAt: Date,
  },
  baseOptions,
);

vendorSchema.index({ 'store.slug': 1 }, { unique: true, partialFilterExpression: { 'store.slug': { $type: 'string' } } });
vendorSchema.index({ status: 1, createdAt: -1 });
vendorSchema.index({ isPlatform: 1 }, { unique: true, partialFilterExpression: { isPlatform: true } });
// Not unique: older sellers may share an email. Email sign-in refuses ambiguous matches,
// and new registrations/profile edits can't reuse another seller's email.
vendorSchema.index({ email: 1 });
vendorSchema.index({ 'business.gstin': 1 }, { unique: true, partialFilterExpression: { 'business.gstin': { $type: 'string' } } });

export const Vendor = mongoose.models.Vendor ?? mongoose.model('Vendor', vendorSchema);
