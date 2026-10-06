import mongoose, { Schema } from 'mongoose';

export const MAX_WISHLIST_ITEMS = 200;

/** One row per saved product: cheap toggles, newest-first listing, and no unbounded array on the user. */
const wishlistItemSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false },
);

wishlistItemSchema.index({ user: 1, product: 1 }, { unique: true });
wishlistItemSchema.index({ user: 1, createdAt: -1 });

export const WishlistItem = mongoose.models.WishlistItem ?? mongoose.model('WishlistItem', wishlistItemSchema);
