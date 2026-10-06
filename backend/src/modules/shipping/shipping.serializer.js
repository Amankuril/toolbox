const CUSTOMER_STEPS = [
  ['created', 'Shipment created'],
  ['courier_assigned', 'Courier assigned'],
  ['picked_up', 'Picked up'],
  ['in_transit', 'In transit'],
  ['out_for_delivery', 'Out for delivery'],
  ['delivered', 'Delivered'],
];
const STEP_RANK = {
  created: 0,
  courier_assigned: 1,
  pickup_scheduled: 1,
  pickup_pending: 1,
  picked_up: 2,
  in_transit: 3,
  exception: 3,
  out_for_delivery: 4,
  delivered: 5,
};

function common(s) {
  return {
    _id: s._id,
    type: s.type,
    status: s.status,
    items: s.items.map((i) => ({ itemId: i.itemId, quantity: i.quantity })),
    courier: s.courier?.name ? { name: s.courier.name, service: s.courier.service ?? null } : null,
    awbNumber: s.awbNumber ?? null,
    tracking: {
      currentStatus: s.tracking?.currentStatus ?? null,
      expectedDeliveryDate: s.tracking?.expectedDeliveryDate ?? null,
      scans: s.tracking?.scans ?? [],
      lastSyncedAt: s.tracking?.lastSyncedAt ?? null,
    },
    pickedUpAt: s.pickedUpAt ?? null,
    deliveredAt: s.deliveredAt ?? null,
    cancelledAt: s.cancelledAt ?? null,
    createdAt: s.createdAt,
  };
}

/** Customer: progress only. No provider ids, warehouse, COD internals or error text. */
export function serializeCustomerShipment(doc) {
  const s = doc.toObject?.() ?? doc;
  const rank = STEP_RANK[s.status];
  return {
    ...common(s),
    vendor: s.vendor,
    steps:
      s.type === 'forward' && rank !== undefined
        ? CUSTOMER_STEPS.map(([key, label], i) => ({ key, label, done: i <= rank, current: i === rank }))
        : [],
  };
}

/** Vendor: their own parcel, with what they need to hand it over. */
export function serializeVendorShipment(doc) {
  const s = doc.toObject?.() ?? doc;
  return {
    ...common(s),
    providerOrderId: s.providerOrderId,
    lrNumber: s.lrNumber ?? null,
    package: s.package ?? null,
    paymentType: s.paymentType,
    codAmount: s.codAmount ?? null,
    pickupScheduledAt: s.pickupScheduledAt ?? null,
  };
}

/** Admin: everything needed to operate and debug the shipment. */
export function serializeAdminShipment(doc) {
  const s = doc.toObject?.() ?? doc;
  return {
    ...serializeVendorShipment(s),
    vendor: s.vendor,
    parent: s.parent ?? null,
    attempt: s.attempt,
    active: s.active,
    provider: s.provider,
    referenceId: s.referenceId ?? null,
    warehouseId: s.warehouseId ?? null,
    courier:
      s.courier?.name || s.courier?.id
        ? { id: s.courier.id ?? null, name: s.courier.name ?? null, service: s.courier.service ?? null }
        : null,
    pickupsAutomaticallyScheduled: s.pickupsAutomaticallyScheduled ?? null,
    rateQuotes: s.rateQuotes ?? [],
    ratesFetchedAt: s.ratesFetchedAt ?? null,
    returnInfo: s.returnInfo?.reasonId ? s.returnInfo : null,
    pushedAt: s.pushedAt ?? null,
    courierAssignedAt: s.courierAssignedAt ?? null,
    busy: Boolean(s.lock?.at),
    needsVerification: Boolean(s.needsVerification),
    failedAttempts: s.failedAttempts ?? 0,
    lastError: s.lastError?.message ? s.lastError : null,
    history: s.history ?? [],
  };
}
