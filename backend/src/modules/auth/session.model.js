import mongoose, { Schema } from 'mongoose';
import { AUDIENCES } from './auth.constants.js';

/**
 * One document per issued refresh token. Rotation creates a new document in the same
 * `family` and revokes the previous one, which lets us detect refresh-token reuse.
 */
const sessionSchema = new Schema(
  {
    subject: { type: Schema.Types.ObjectId, required: true },
    audience: { type: String, enum: AUDIENCES, required: true },
    tokenHash: { type: String, required: true, unique: true },
    family: { type: String, required: true, index: true },
    userAgent: { type: String, maxlength: 400 },
    ip: String,
    expiresAt: { type: Date, required: true },
    revokedAt: Date,
    revokedReason: { type: String, enum: ['rotated', 'logout', 'reuse_detected', 'admin', 'password_change'] },
  },
  { timestamps: true, versionKey: false },
);

sessionSchema.index({ subject: 1, audience: 1 });
// MongoDB removes documents once expiresAt passes.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Session = mongoose.models.Session ?? mongoose.model('Session', sessionSchema);
