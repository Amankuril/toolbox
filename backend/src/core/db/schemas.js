import { Schema } from 'mongoose';

/** Reference to an uploaded image. `url` is denormalised so reads never need a join. */
export const imageSchema = new Schema(
  {
    media: { type: Schema.Types.ObjectId, ref: 'Media', required: true },
    url: { type: String, required: true },
    alt: { type: String, trim: true, maxlength: 200 },
  },
  { _id: false },
);

export const addressFields = {
  line1: { type: String, required: true, trim: true, maxlength: 200 },
  line2: { type: String, trim: true, maxlength: 200 },
  landmark: { type: String, trim: true, maxlength: 120 },
  city: { type: String, required: true, trim: true, maxlength: 80 },
  state: { type: String, required: true, trim: true, maxlength: 80 },
  pincode: { type: String, required: true, trim: true, match: /^[1-9]\d{5}$/ },
};

export const addressSchema = new Schema(addressFields, { _id: false });

/** Who performed an action. `kind` is the audience, `id` the account. */
export const actorSchema = new Schema(
  {
    kind: { type: String, enum: ['admin', 'vendor', 'user', 'system'], required: true },
    id: { type: Schema.Types.ObjectId },
  },
  { _id: false },
);

/** Default schema options: no __v, timestamps on. */
export const baseOptions = { timestamps: true, versionKey: false };
