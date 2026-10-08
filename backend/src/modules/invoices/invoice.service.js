import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { withLock } from '#core/utils/lock.js';
import { gstFromInclusive } from '#core/utils/money.js';
import { financialYear, partyStateCode, stateCode, stateName } from '#core/utils/gst.js';
import { Order } from '#modules/orders/order.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { Invoice, InvoiceCounter } from './invoice.model.js';
import { renderInvoicePdf } from './invoice.pdf.js';

const SHIPPED = ['shipped', 'delivered'];
const activeLines = (order, vendorId) => order.items.filter((i) => String(i.vendor) === String(vendorId) && i.status !== 'cancelled');

/** A seller's part of an order can be invoiced once every line of theirs that wasn't cancelled has shipped. */
export function invoiceReady(order, vendorId) {
  const lines = activeLines(order, vendorId);
  return lines.length > 0 && lines.every((i) => SHIPPED.includes(i.status)) && order.status !== 'pending_payment';
}

/** The seller whose invoice carries the delivery charge: the first one with lines left (as COD amounts are split). */
const shippingSeller = (order) => order.vendors.find((v) => activeLines(order, v).length);

/** Up to 4 letters from the store name: "Shakti Industrial" → "SHAK". GST numbers allow 16 characters. */
const prefixFor = (vendor) =>
  (vendor.store?.name ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 4) || 'INV';

/** When the seller shipped: the latest "shipped" (or "delivered") step on their lines. */
function supplyDate(lines) {
  const dates = lines.flatMap((i) => (i.history ?? []).filter((h) => SHIPPED.includes(h.status)).map((h) => new Date(h.at)));
  return dates.length ? new Date(Math.max(...dates)) : new Date();
}

function splitTax(tax, interState) {
  if (interState) return { cgst: 0, sgst: 0, igst: tax };
  const cgst = Math.floor(tax / 2);
  return { cgst, sgst: tax - cgst, igst: 0 };
}

function buildInvoice(order, vendor, issuedAt) {
  const lines = activeLines(order, vendor._id);
  const sellerState = partyStateCode({ gstin: vendor.business?.gstin, state: vendor.address?.state });
  const supplyState = stateCode(order.shippingAddress.state);
  // Unknown either side: treat as inter-state (IGST), the safer default for a marketplace shipping across India.
  const interState = !sellerState || !supplyState || sellerState !== supplyState;

  const invoiceLines = lines.map((i) => ({
    itemId: i._id,
    name: i.name,
    sku: i.sku,
    variant: i.variant?.title,
    hsnCode: i.hsnCode,
    quantity: i.quantity,
    unitPrice: i.unitPrice,
    discount: i.discount ?? 0,
    taxable: i.lineTotal - i.taxAmount,
    gstRate: i.gstRate,
    tax: i.taxAmount,
    amount: i.lineTotal,
  }));

  // Delivery is part of a composite supply, so it takes the GST rate of the main item (the largest line).
  let shipping;
  if (order.amounts.shipping > 0 && String(shippingSeller(order)) === String(vendor._id)) {
    const main = [...lines].sort((a, b) => b.lineTotal - a.lineTotal)[0];
    const tax = gstFromInclusive(order.amounts.shipping, main.gstRate);
    shipping = { amount: order.amounts.shipping, taxable: order.amounts.shipping - tax, gstRate: main.gstRate, tax };
  }

  const tax = invoiceLines.reduce((s, l) => s + l.tax, 0) + (shipping?.tax ?? 0);
  const a = order.shippingAddress;
  return {
    order: order._id,
    vendor: vendor._id,
    issuedAt,
    orderNumber: order.orderNumber,
    orderDate: order.createdAt,
    paymentMethod: order.payment.method,
    seller: {
      name: vendor.business?.legalName || vendor.store?.name,
      businessName: vendor.store?.name,
      gstin: vendor.business?.gstin,
      address: vendor.address,
      stateCode: sellerState,
    },
    buyer: {
      name: order.billing?.name ?? a.name,
      businessName: order.billing?.businessName,
      gstin: order.billing?.gstin,
      phone: a.phone,
      address: { line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, state: a.state, pincode: a.pincode },
      stateCode: supplyState,
    },
    shipTo: {
      name: a.name,
      phone: a.phone,
      address: { line1: a.line1, line2: a.line2, landmark: a.landmark, city: a.city, state: a.state, pincode: a.pincode },
      stateCode: supplyState,
    },
    placeOfSupply: supplyState ? `${stateName(supplyState)} (${supplyState})` : a.state,
    interState,
    lines: invoiceLines,
    shipping,
    totals: {
      taxable: invoiceLines.reduce((s, l) => s + l.taxable, 0) + (shipping?.taxable ?? 0),
      ...splitTax(tax, interState),
      discount: invoiceLines.reduce((s, l) => s + l.discount, 0),
      total: invoiceLines.reduce((s, l) => s + l.amount, 0) + (shipping?.amount ?? 0),
    },
  };
}

/**
 * Issues the seller's invoice for this order if it's due and doesn't exist yet. The caller must hold the
 * order lock (order updates do), so two requests can never take two numbers for one invoice.
 */
async function issue(order, vendorId) {
  const existing = await Invoice.findOne({ order: order._id, vendor: vendorId }).lean();
  if (existing || !invoiceReady(order, vendorId)) return existing;

  const vendor = await Vendor.findById(vendorId).select('store business address').lean();
  const lines = activeLines(order, vendorId);
  const issuedAt = supplyDate(lines);
  const fy = financialYear(issuedAt);
  const counter = await InvoiceCounter.findOneAndUpdate(
    { vendor: vendorId, fy },
    { $inc: { seq: 1 }, $setOnInsert: { prefix: prefixFor(vendor) } },
    { upsert: true, returnDocument: 'after' },
  );
  const number = `${counter.prefix}/${fy}/${String(counter.seq).padStart(4, '0')}`;
  const invoice = await Invoice.create({ ...buildInvoice(order, vendor, issuedAt), number, fy, seq: counter.seq });
  logger.info({ orderId: order._id, vendorId, number }, 'Invoice issued');
  return invoice.toObject();
}

/** Summary shown on order pages. */
const summarize = (invoice) => ({ number: invoice.number, issuedAt: invoice.issuedAt, total: invoice.totals.total });

export const invoiceService = {
  invoiceReady,

  /** Called after an order line changes status (inside the order lock). Never fails the update itself. */
  async issueIfReady(order, vendorId) {
    try {
      return await issue(order, vendorId);
    } catch (err) {
      logger.error({ err, orderId: order._id, vendorId }, 'Invoice could not be issued; it will be issued on first download');
      return null;
    }
  },

  /**
   * One entry per seller on the order: issued, or what it's waiting for.
   * @param {{ userId?: any, vendorId?: any }} scope buyers see their orders, sellers only their own invoice
   */
  async forOrder(orderId, scope = {}) {
    const order = await Order.findOne({
      _id: orderId,
      ...(scope.userId ? { user: scope.userId } : {}),
      ...(scope.vendorId ? { vendors: scope.vendorId } : {}),
    })
      .select('vendors items status')
      .lean();
    if (!order) throw ApiError.notFound('Order not found');
    const vendorIds = (scope.vendorId ? [scope.vendorId] : order.vendors).filter((v) =>
      order.items.some((i) => String(i.vendor) === String(v)),
    );
    const [invoices, vendors] = await Promise.all([
      Invoice.find({ order: order._id, vendor: { $in: vendorIds } }).lean(),
      Vendor.find({ _id: { $in: vendorIds } }, 'store.name').lean(),
    ]);
    const nameOf = new Map(vendors.map((v) => [String(v._id), v.store?.name]));
    return vendorIds.map((v) => {
      const invoice = invoices.find((i) => String(i.vendor) === String(v));
      const cancelled = !activeLines(order, v).length;
      return {
        vendor: v,
        storeName: nameOf.get(String(v)) ?? 'Seller',
        status: invoice ? 'issued' : cancelled ? 'cancelled' : invoiceReady(order, v) ? 'ready' : 'awaiting_shipment',
        ...(invoice ? summarize(invoice) : {}),
      };
    });
  },

  /**
   * The invoice PDF for one seller's part of an order, issuing it first if it's due (orders shipped
   * before invoices existed, or a failed issue).
   * @returns {Promise<{ filename: string, pdf: Buffer }>}
   */
  async pdf(orderId, vendorId, scope = {}) {
    const order = await Order.findOne({ _id: orderId, vendors: vendorId, ...(scope.userId ? { user: scope.userId } : {}) })
      .select('_id')
      .lean();
    if (!order) throw ApiError.notFound('Order not found');

    let invoice = await Invoice.findOne({ order: orderId, vendor: vendorId }).lean();
    if (!invoice) {
      invoice = await withLock(`order:${orderId}`, async () => issue(await Order.findById(orderId), vendorId), { waitMs: 10_000 });
    }
    if (!invoice) {
      throw ApiError.conflict('The invoice is issued once these items ship.', { code: 'INVOICE_NOT_READY' });
    }
    const pdf = await renderInvoicePdf(invoice);
    return { filename: `Invoice-${invoice.number.replace(/\//g, '-')}.pdf`, pdf };
  },
};
