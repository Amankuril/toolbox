import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';
import { ACCESS_LEVELS, SECTION_KEYS } from './permissions.js';

export const ADMIN_ROLES = ['super_admin', 'admin'];
export const ADMIN_STATUSES = ['active', 'disabled'];

/** Per-section access for role "admin". Absent = an admin from before permissions existed (full access). */
const permissionsSchema = new Schema(
  Object.fromEntries(SECTION_KEYS.map((k) => [k, { type: String, enum: ACCESS_LEVELS, default: 'none' }])),
  { _id: false },
);

const adminSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, unique: true, trim: true, lowercase: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ADMIN_ROLES, default: 'admin' },
    status: { type: String, enum: ADMIN_STATUSES, default: 'active' },
    permissions: { type: permissionsSchema, default: undefined },
    lastLoginAt: Date,
    passwordChangedAt: Date,
  },
  baseOptions,
);

export const Admin = mongoose.models.Admin ?? mongoose.model('Admin', adminSchema);
