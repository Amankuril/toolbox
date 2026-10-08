import mongoose, { Schema } from 'mongoose';
import { baseOptions } from '#core/db/schemas.js';

const partySchema = new Schema(
  {
    name: String,
    businessName: String,
    gstin: String,
    phone: String,
    address: { line1: String, line2: String, landmark: String, city: String, state: String, pincode: String },
    stateCode: String,
  },
  { _id: false },
);

const lineSchema = new Schema(
  {
    itemId: Schema.Types.ObjectId,
    name: String,
    sku: String,
    variant: String,
    hsnCode: String,
    quantity: Number,
    unit: String,
    // All paise. unitPrice is GST-inclusive, as listed; amount = unitPrice × quantity − discount.
    unitPrice: Number,
    discount: Number,
    taxable: Number,
    gstRate: Number,
    tax: Number,
    amount: Number,
  },
  { _id: false },
);

/**
 * A seller's GST tax invoice for their part of one order. Issued once all of that seller's
 * (non-cancelled) lines have shipped, and frozen: later edits to the seller, buyer or product
 * never change an issued invoice.
 */
const invoiceSchema = new Schema(
  {
    order: { type: Schema.Types.ObjectId, ref: 'Order', required: true },
    vendor: { type: Schema.Types.ObjectId, ref: 'Vendor', required: true },
    number: { type: String, required: true },
    fy: { type: String, required: true },
    seq: { type: Number, required: true },
    issuedAt: { type: Date, required: true },
    orderNumber: String,
    orderDate: Date,
    paymentMethod: String,
    seller: partySchema,
    buyer: partySchema,
    shipTo: partySchema,
    placeOfSupply: String,
    interState: Boolean,
    lines: [lineSchema],
    // The order's delivery charge (on the first seller's invoice only), GST-inclusive.
    shipping: { amount: Number, taxable: Number, gstRate: Number, tax: Number },
    totals: { taxable: Number, cgst: Number, sgst: Number, igst: Number, discount: Number, total: Number },
  },
  baseOptions,
);

invoiceSchema.index({ order: 1, vendor: 1 }, { unique: true });
invoiceSchema.index({ vendor: 1, fy: 1, seq: 1 }, { unique: true });

export const Invoice = mongoose.models.Invoice ?? mongoose.model('Invoice', invoiceSchema);

/** Next invoice number per seller per financial year. The prefix is fixed when the year's series starts. */
const counterSchema = new Schema(
  {
    vendor: { type: Schema.Types.ObjectId, required: true },
    fy: { type: String, required: true },
    prefix: { type: String, required: true },
    seq: { type: Number, default: 0 },
  },
  { versionKey: false },
);
counterSchema.index({ vendor: 1, fy: 1 }, { unique: true });

export const InvoiceCounter = mongoose.models.InvoiceCounter ?? mongoose.model('InvoiceCounter', counterSchema);
