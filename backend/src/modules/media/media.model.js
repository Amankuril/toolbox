import mongoose, { Schema } from 'mongoose';
import { actorSchema } from '#core/db/schemas.js';

export const MEDIA_FOLDERS = ['products', 'categories', 'vendors', 'documents', 'banners', 'branding', 'users'];

/**
 * Registry of every stored file. `provider` records where the bytes actually live, so files
 * remain deletable even after the admin flips the storage toggle.
 */
const mediaSchema = new Schema(
  {
    provider: { type: String, enum: ['local', 'cloudinary'], required: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    folder: { type: String, enum: MEDIA_FOLDERS, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    width: Number,
    height: Number,
    originalName: { type: String, maxlength: 255 },
    originalSize: Number,
    uploadedBy: { type: actorSchema, required: true },
  },
  { timestamps: true, versionKey: false },
);

mediaSchema.index({ 'uploadedBy.kind': 1, 'uploadedBy.id': 1, createdAt: -1 });
mediaSchema.index({ folder: 1, createdAt: -1 });

export const Media = mongoose.models.Media ?? mongoose.model('Media', mediaSchema);
