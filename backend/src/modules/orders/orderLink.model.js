import mongoose, { Schema } from 'mongoose';
import { actorSchema, addressFields, baseOptions } from '#core/db/schemas.js';

/**
 * open      → waiting for the customer to pay
 * paid      → paid; `order` is the order it became
 * cancelled → withdrawn from the panel
 * (an open link past expiresAt reads as expired)
 */
export const ORDER_LINK_STATUSES = ['open', 'paid', 'cancelled'];
export const ORDER_LINK_DAYS = { default: 7, max: 30 };

/** What the panel put on the order. Prices are fixed when the link is made; stock is taken when the customer pays. */
const linkItemSchema = new Schema(
  {
    product: { type: Schema.Types.ObjectId, ref: 'Product', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    variant: { id: Schema.Types.ObjectId, title: String },
    name: { type: String, required: true },
    image: String,
    unitPrice: { type: Number, required: true, min: 0 },
    quantity: { type: Number, required: true, min: 1 },
  },
  { _id: false },
);

/** A ready-made order shared with a customer as a link: they open it and pay, no sign-in. */
const orderLinkSchema = new Schema(
  {
    // Unguessable; the only thing that grants access to the link.
    token: { type: String, required: true, unique: true },
    createdBy: { type: actorSchema, required: true },
    // Set when a seller made it: they can only see and cancel their own links.
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor' },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    shippingAddress: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
      ...addressFields,
    },
    items: { type: [linkItemSchema], required: true },
    // Paise; the same split the order will get.
    amounts: {
      subtotal: { type: Number, required: true },
      discount: { type: Number, default: 0 },
      shipping: { type: Number, default: 0 },
      total: { type: Number, required: true },
    },
    notes: { type: String, trim: true, maxlength: 500 },
    status: { type: String, enum: ORDER_LINK_STATUSES, default: 'open' },
    expiresAt: { type: Date, required: true },
    // The order behind the latest payment attempt; the paid order once paid.
    order: { type: Schema.Types.ObjectId, ref: 'Order' },
    paidAt: Date,
  },
  baseOptions,
);

orderLinkSchema.index({ vendor: 1, createdAt: -1 });
orderLinkSchema.index({ status: 1, createdAt: -1 });

export const OrderLink = mongoose.models.OrderLink ?? mongoose.model('OrderLink', orderLinkSchema);

/** A link is done once the order behind it is paid (by the customer, a webhook, or a late payment). */
export async function markLinkPaid(order) {
  if (!order?.link) return;
  await OrderLink.updateOne({ _id: order.link, status: { $ne: 'paid' } }, { status: 'paid', order: order._id, paidAt: order.payment?.paidAt ?? new Date() });
}
