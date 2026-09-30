import mongoose, { Schema } from 'mongoose';
import { actorSchema } from '#core/db/schemas.js';

const settingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: actorSchema,
  },
  { timestamps: true, versionKey: false, minimize: false },
);

export const Setting = mongoose.models.Setting ?? mongoose.model('Setting', settingSchema);
