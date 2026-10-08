function serializeItem(i) {
  return {
    _id: i._id,
    product: i.product,
    vendor: i.vendor,
    name: i.name,
    slug: i.slug,
    sku: i.sku ?? null,
    variant: i.variant?.id ? { id: i.variant.id, title: i.variant.title } : null,
    image: i.image ?? null,
    type: i.type,
    hsnCode: i.hsnCode ?? null,
    unitPrice: i.unitPrice,
    basePrice: i.basePrice ?? i.unitPrice,
    unitMrp: i.unitMrp,
    pricing: { source: i.pricing?.source ?? 'base', tierMinQty: i.pricing?.tierMinQty ?? null, quote: i.pricing?.quote ?? null },
    gstRate: i.gstRate,
    quantity: i.quantity,
    lineTotal: i.lineTotal,
    discount: i.discount ?? 0,
    taxAmount: i.taxAmount,
    status: i.status,
    tracking: i.tracking?.trackingNumber ? i.tracking : null,
    refunded: Boolean(i.refunded),
    history: i.history ?? [],
  };
}

function base(o) {
  return {
    _id: o._id,
    orderNumber: o.orderNumber,
    status: o.status,
    shippingAddress: o.shippingAddress,
    billing: o.billing?.gstin || o.billing?.businessName ? o.billing : null,
    notes: o.notes ?? null,
    payment: {
      method: o.payment.method,
      status: o.payment.status,
      paidAt: o.payment.paidAt ?? null,
      failureReason: o.payment.failureReason ?? null,
    },
    expiresAt: o.expiresAt ?? null,
    cancelledAt: o.cancelledAt ?? null,
    cancelReason: o.cancelReason ?? null,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
  };
}

/** Customer / admin view: the whole order. */
export function serializeOrder(o) {
  const doc = o.toObject?.() ?? o;
  return {
    ...base(doc),
    user: doc.user,
    items: doc.items.map(serializeItem),
    amounts: doc.amounts,
    coupon: doc.coupon?.code ? { code: doc.coupon.code, vendor: doc.coupon.vendor } : null,
    refunds: doc.refunds ?? [],
  };
}

/** Vendor view: only the vendor's own lines and their totals. */
export function serializeVendorOrder(o, vendorId) {
  const doc = o.toObject?.() ?? o;
  const items = doc.items.filter((i) => String(i.vendor) === String(vendorId)).map(serializeItem);
  const active = items.filter((i) => i.status !== 'cancelled');
  return {
    ...base(doc),
    items,
    coupon: doc.coupon?.code && String(doc.coupon.vendor) === String(vendorId) ? { code: doc.coupon.code } : null,
    amounts: {
      // Net of coupon shares: what the seller is paid for.
      subtotal: active.reduce((s, i) => s + i.lineTotal, 0),
      discount: active.reduce((s, i) => s + i.discount, 0),
      tax: active.reduce((s, i) => s + i.taxAmount, 0),
      itemCount: active.reduce((n, i) => n + i.quantity, 0),
    },
  };
}
