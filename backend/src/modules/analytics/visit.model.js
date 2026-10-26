import mongoose, { Schema } from 'mongoose';

export const TRAFFIC_SOURCES = ['direct', 'whatsapp', 'google', 'facebook', 'instagram', 'other'];

/**
 * Storefront views per seller per day: the store page (product unset) and each product page.
 * Unique visitors are counted separately in Redis (HyperLogLog), since a count can't be summed across days.
 */
const visitDaySchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', default: null },
    // Local (IST) calendar day, YYYY-MM-DD.
    day: { type: String, required: true },
    views: { type: Number, default: 0 },
    sources: Object.fromEntries(TRAFFIC_SOURCES.map((s) => [s, { type: Number, default: 0 }])),
    // Kept a little over a year, then removed by the TTL index.
    _expires: Date,
  },
  { versionKey: false },
);

visitDaySchema.index({ vendor: 1, product: 1, day: 1 }, { unique: true });
visitDaySchema.index({ vendor: 1, day: 1 });
visitDaySchema.index({ _expires: 1 }, { expireAfterSeconds: 0 });

export const VisitDay = mongoose.models.VisitDay ?? mongoose.model('VisitDay', visitDaySchema);
