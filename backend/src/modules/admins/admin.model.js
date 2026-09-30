import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

export const ADMIN_ROLES = ['super_admin', 'admin'];
export const ADMIN_STATUSES = ['active', 'disabled'];

const adminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: 'admin' },
    status: { type: String, enum: ADMIN_STATUSES, default: 'active' },
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  baseOptions,
);

export const Admin = mongoose.models.Admin ?? mongoose.model('Admin', adminSchema);
