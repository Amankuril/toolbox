import mongoose, { Schema } from 'mongoose';

export const MAX_CART_ITEMS = 50;

const cartItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    // The product's seller, copied in so sellers can find carts holding their products (leads).
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
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
    // The buyer's coupon code; priced (or flagged unusable) every time the cart is read.
    coupon: {
      id: { type: Schema.Types.ObjectId, ref: 'Coupon' },
      code: String,
    },
  },
  { timestamps: true, versionKey: false },
);

// Seller leads: carts holding a seller's products, newest activity first.
cartSchema.index({ 'items.vendor': 1, updatedAt: -1 });

export const Cart = mongoose.models.Cart ?? mongoose.model('Cart', cartSchema);
