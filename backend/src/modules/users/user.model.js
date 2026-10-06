import mongoose, { Schema } from 'mongoose';
import { addressFields, baseOptions, imageSchema } from '#core/db/schemas.js';

export const USER_STATUSES = ['active', 'blocked'];
export const ACCOUNT_TYPES = ['individual', 'business'];

const savedAddressSchema = new Schema({
  label: { type: String, trim: true, maxlength: 40, default: 'Home' },
  name: { type: String, required: true, trim: true, maxlength: 120 },
  phone: { type: String, required: true, trim: true },
  ...addressFields,
  isDefault: { type: Boolean, default: false },
});

const userSchema = new Schema(
  {
    // Optional for accounts created by email sign-in.
    phone: { type: String, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, trim: true, lowercase: true },
    // Set when the email was proven by a sign-in code; cleared if the email changes.
    emailVerifiedAt: Date,
    accountType: { type: String, enum: ACCOUNT_TYPES, default: 'individual' },
    business: {
      name: { type: String, trim: true, maxlength: 200 },
      gstin: { type: String, trim: true, uppercase: true },
    },
    avatar: imageSchema,
    status: { type: String, enum: USER_STATUSES, default: 'active' },
    addresses: { type: [savedAddressSchema], default: [] },
    lastLoginAt: Date,
  },
  baseOptions,
);

userSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { phone: { $type: 'string' } } });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { email: { $type: 'string' } } });
userSchema.index({ status: 1, createdAt: -1 });

export const User = mongoose.models.User ?? mongoose.model('User', userSchema);
