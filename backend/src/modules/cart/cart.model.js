import mongoose, { Schema } from 'mongoose';

export const MAX_CART_ITEMS = 50;

const cartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    // Set for products with variants; one line per (product, variant).
    variant: { type: Schema.Types.ObjectId },
    quantity: { type: Number, required: true, min: 1 },
    // Set when the line comes from an accepted quote: quantity and unit price are locked to it.
    quote: { type: Schema.Types.ObjectId, ref: 'Quote' },
    addedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const cartSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    items: { type: [cartItemSchema], default: [] },
  },
  { timestamps: true, versionKey: false },
);

export const Cart = mongoose.models.Cart ?? mongoose.model('Cart', cartSchema);
