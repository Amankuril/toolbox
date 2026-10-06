import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Order } from '#modules/orders/order.model.js';
import { orderService } from '#modules/orders/order.service.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { ShippingProviderError, toApiError } from '#services/shipping/shipping.errors.js';
import { shippingProvider } from '#services/shipping/shipping.provider.js';
import { settingsService } from '#services/settings/settings.service.js';
import { PRE_PICKUP_STATUSES, Shipment, TERMINAL_SHIPMENT_STATUSES, TRACKABLE_STATUSES } from './shipment.model.js';
import { computePackage } from './shipping.package.js';
import { allocate } from '#modules/orders/partialPayment.js';

const SYSTEM = { kind: 'system' };
// A provider call that hasn't released its lock after this long is assumed to have crashed.
const LOCK_STALE_MS = 2 * 60_000;
const MAX_AUTO_RETRIES = 5;
const TRACKING_STALE_MS = 30 * 60_000;
const CUSTOMER_REFRESH_MS = 15 * 60_000;
const SHIPPABLE_ORDER_STATUSES = ['placed', 'processing'];
const RATE_QUOTES_TTL_MS = 60 * 60_000;

/** Status order for forward tracking; sync never moves a shipment backwards. */
const PROGRESS = [
  'pending',
  'created',
  'courier_assigned',
  'pickup_scheduled',
  'pickup_pending',
  'picked_up',
  'in_transit',
  'out_for_delivery',
  'delivered',
];

const activeLines = (order, vendorId) => order.items.filter((i) => String(i.vendor) === String(vendorId) && i.status !== 'cancelled');

function forwardProviderOrderId(order, vendorId, attempt) {
  // A single-seller order uses the website order number as-is, as Shipmozo recommends.
  const index = order.vendors.findIndex((v) => String(v) === String(vendorId));
  let id = order.vendors.length > 1 ? `${order.orderNumber}-${index + 1}` : order.orderNumber;
  if (attempt > 1) id += `-A${attempt}`;
  return id;
}

/** Atomically takes the shipment for one provider operation, or reports why it can't. */
async function claim(id, operation, statusFilter) {
  const staleBefore = new Date(Date.now() - LOCK_STALE_MS);
  const claimed = await Shipment.findOneAndUpdate(
    {
      _id: id,
      ...(statusFilter ? { status: { $in: statusFilter } } : {}),
      $or: [{ 'lock.at': { $exists: false } }, { 'lock.at': null }, { 'lock.at': { $lt: staleBefore } }],
    },
    { $set: { lock: { operation, at: new Date() } } },
    { returnDocument: 'after' },
  );
  if (claimed) return claimed;
  const current = await Shipment.findById(id).lean();
  if (!current) throw ApiError.notFound('Shipment not found');
  if (current.lock?.at && current.lock.at >= staleBefore) {
    throw ApiError.conflict('Another shipping action is already in progress for this shipment', { code: 'SHIPMENT_BUSY' });
  }
  throw ApiError.conflict(`This shipment is ${current.status.replaceAll('_', ' ')} and cannot be changed this way`, {
    code: 'INVALID_SHIPMENT_STATE',
  });
}

function setStatus(shipment, status, by, note) {
  if (shipment.status === status) return false;
  shipment.status = status;
  shipment.history.push({ status, by, note: note?.slice(0, 500) });
  return true;
}

async function fail(shipment, err, operation) {
  shipment.lock = undefined;
  shipment.lastError = { operation, message: (err.providerMessage ?? err.message).slice(0, 300), at: new Date() };
  shipment.failedAttempts += 1;
  if (operation === 'push' && err instanceof ShippingProviderError && err.outcomeUnknown) shipment.needsVerification = true;
  await shipment.save();
  logger.warn(
    { shipmentId: shipment._id, orderId: shipment.order, operation, kind: err.kind, providerMessage: err.providerMessage },
    'Shipping provider call failed',
  );
}

async function release(shipment) {
  shipment.lock = undefined;
  shipment.lastError = undefined;
  await shipment.save();
}

/** Every vendor's pickup address is registered once as a Shipmozo warehouse; the id is kept on the vendor. */
async function ensureWarehouse(provider, vendorId) {
  const vendor = await Vendor.findById(vendorId, 'phone email contactName store.name address shipping').lean();
  if (!vendor) throw ApiError.notFound('Vendor not found');
  if (vendor.shipping?.warehouseId) return vendor.shipping.warehouseId;
  if (!vendor.address?.pincode) throw ApiError.unprocessable('This seller has no pickup address yet', { code: 'VENDOR_NO_ADDRESS' });

  // address_title must be unique; Shipmozo hands back the existing id for a reused title, so retries are safe.
  const { warehouseId } = await provider.createWarehouse({
    title: `TH-${vendor._id}`,
    name: vendor.contactName ?? vendor.store?.name,
    phone: vendor.phone,
    email: vendor.email,
    address: vendor.address,
  });
  await Vendor.updateOne({ _id: vendorId }, { 'shipping.warehouseId': warehouseId, 'shipping.warehouseSyncedAt': new Date() });
  logger.info({ vendorId, warehouseId }, 'Registered vendor warehouse with Shipmozo');
  return warehouseId;
}

/** Moves the vendor's line items along with the shipment, reusing the existing fulfilment rules (COD paid-on-delivery etc.). */
async function syncOrderItems(shipment) {
  if (shipment.type !== 'forward') return;
  const target = ['picked_up', 'in_transit', 'out_for_delivery'].includes(shipment.status)
    ? 'shipped'
    : shipment.status === 'delivered'
      ? 'delivered'
      : null;
  if (!target) return;

  const order = await Order.findById(shipment.order, 'items status');
  if (!order) return;
  const steps = { pending: 'confirmed', confirmed: 'shipped', packed: 'shipped', shipped: target === 'delivered' ? 'delivered' : null };
  const tracking = { carrier: shipment.courier?.name?.slice(0, 80), trackingNumber: shipment.awbNumber?.slice(0, 80) };

  for (const ref of shipment.items) {
    let item = order.items.id(ref.itemId);
    while (item && item.status !== target && steps[item.status]) {
      const next = steps[item.status];
      const updated = await orderService.updateItem(
        { orderId: shipment.order, itemId: ref.itemId },
        {
          status: next,
          ...(next === 'shipped' ? { tracking } : {}),
          note: `Shipment ${shipment.providerOrderId}: ${shipment.tracking?.currentStatus ?? shipment.status}`,
        },
        SYSTEM,
      );
      item = updated.items.id(ref.itemId);
    }
  }
}

export const shippingService = {
  /* ─────────────────────────── Planning & creation ─────────────────────────── */

  /**
   * Creates a pending forward shipment for every seller on the order that has unshipped lines.
   * Idempotent: the unique (order, vendor) index means concurrent calls can't create twins.
   */
  async planForOrder(orderId) {
    const provider = await shippingProvider.require();
    const order = await Order.findById(orderId).lean();
    if (!order) throw ApiError.notFound('Order not found');
    if (!SHIPPABLE_ORDER_STATUSES.includes(order.status)) return [];

    const existing = await Shipment.find({ order: order._id, type: 'forward' }, 'vendor active attempt').lean();
    const planned = [];
    for (const vendorId of order.vendors) {
      const lines = activeLines(order, vendorId);
      const mine = existing.filter((s) => String(s.vendor) === String(vendorId));
      if (!lines.length || mine.some((s) => s.active)) continue;
      // Already-shipped lines aren't re-shipped automatically.
      if (lines.every((i) => ['shipped', 'delivered'].includes(i.status))) continue;
      const attempt = mine.reduce((n, s) => Math.max(n, s.attempt), 0) + 1;
      try {
        planned.push(
          await Shipment.create({
            order: order._id,
            orderNumber: order.orderNumber,
            user: order.user,
            vendor: vendorId,
            type: 'forward',
            attempt,
            provider: provider.name,
            providerOrderId: forwardProviderOrderId(order, vendorId, attempt),
            items: lines.map((i) => ({ itemId: i._id, quantity: i.quantity })),
            // Partial orders: the courier collects the balance in cash, so they ship as COD.
            paymentType: ['cod', 'partial'].includes(order.payment.method) ? 'cod' : 'prepaid',
            status: 'pending',
            history: [{ status: 'pending', by: SYSTEM }],
          }),
        );
      } catch (err) {
        if (err?.code !== 11000) throw err; // a concurrent planner won the race
      }
    }
    return planned;
  },

  /**
   * Pushes a pending shipment to the provider. Safe to call repeatedly:
   *  - the lock + status filter stop concurrent pushes,
   *  - a push whose outcome was unknown (timeout) is first verified with get-order-detail,
   *  - the provider order id is deterministic, so a retry never mints a second order.
   */
  async push(shipmentId, actor = SYSTEM) {
    const provider = await shippingProvider.require();
    const shipment = await claim(shipmentId, 'push', ['pending']);
    try {
      if (shipment.type !== 'forward')
        throw ApiError.conflict('Use the return push for return shipments', { code: 'INVALID_SHIPMENT_STATE' });
      const order = await Order.findById(shipment.order).populate('user', 'email').lean();
      if (!order) throw ApiError.notFound('Order not found');
      if (!SHIPPABLE_ORDER_STATUSES.includes(order.status) && order.status !== 'cancelled') {
        throw ApiError.conflict(`An order that is ${order.status.replaceAll('_', ' ')} cannot be shipped`, { code: 'ORDER_NOT_SHIPPABLE' });
      }
      const lines = activeLines(order, shipment.vendor);
      if (!lines.length) {
        shipment.active = false;
        shipment.cancelledAt = new Date();
        setStatus(shipment, 'cancelled', actor, 'All items for this seller were cancelled before shipping');
        await release(shipment);
        return shipment;
      }

      const { defaultPackage } = await settingsService.get('shipping');
      shipment.items = lines.map((i) => ({ itemId: i._id, quantity: i.quantity }));
      shipment.package = await computePackage(lines, defaultPackage);
      shipment.warehouseId = await ensureWarehouse(provider, shipment.vendor);
      if (shipment.paymentType === 'cod') {
        // Each seller's parcel collects its own lines; the shipping fee rides with the first seller's parcel.
        const sellers = order.vendors.filter((v) => activeLines(order, v).length);
        const values = sellers.map(
          (v, i) => activeLines(order, v).reduce((sum, l) => sum + l.lineTotal, 0) + (i === 0 ? order.amounts.shipping : 0),
        );
        const mine = sellers.findIndex((v) => String(v) === String(shipment.vendor));
        // Partial orders only collect the balance, split across parcels in proportion and exact to the paisa.
        shipment.codAmount = order.payment.method === 'partial' ? allocate(order.amounts.balanceDue ?? 0, values)[mine] : values[mine];
      }

      let alreadyThere = false;
      if (shipment.needsVerification) {
        alreadyThere = await provider.orderExists(shipment.providerOrderId);
        logger.info({ shipmentId: shipment._id, alreadyThere }, 'Verified shipment after unknown push outcome');
      }

      logger.info({ shipmentId: shipment._id, orderId: order._id, providerOrderId: shipment.providerOrderId }, 'Shipment creation started');
      const result = alreadyThere
        ? { providerOrderId: shipment.providerOrderId, referenceId: null }
        : await provider.pushOrder({
            providerOrderId: shipment.providerOrderId,
            orderDate: order.createdAt,
            consignee: {
              name: order.shippingAddress.name,
              phone: order.shippingAddress.phone,
              email: order.user?.email,
              address: order.shippingAddress,
            },
            items: lines,
            paymentType: shipment.paymentType,
            codAmount: shipment.codAmount,
            package: shipment.package,
            warehouseId: shipment.warehouseId,
            gstin: order.billing?.gstin,
          });

      shipment.referenceId = result.referenceId ?? shipment.referenceId;
      shipment.needsVerification = false;
      shipment.failedAttempts = 0;
      shipment.pushedAt = new Date();
      setStatus(shipment, 'created', actor);
      await release(shipment);
      logger.info({ shipmentId: shipment._id, orderId: order._id, referenceId: shipment.referenceId }, 'Shipment created');
    } catch (err) {
      await fail(shipment, err, 'push');
      throw toApiError(err);
    }

    const { autoAssignCourier } = await settingsService.get('shipping');
    if (autoAssignCourier) {
      // Courier assignment failing doesn't undo the shipment; the admin can assign manually.
      await this.assignCourier(shipment._id, { auto: true }, actor).catch(() => {});
    }
    return Shipment.findById(shipment._id);
  },

  /* ─────────────────────────── Courier & pickup ─────────────────────────── */

  /** Fetches courier options for a created shipment and remembers them so assignment can be validated. */
  async rates(shipmentId) {
    const provider = await shippingProvider.require();
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw ApiError.notFound('Shipment not found');
    if (shipment.status !== 'created')
      throw ApiError.conflict('Courier rates are available once the shipment is created and before a courier is assigned', {
        code: 'INVALID_SHIPMENT_STATE',
      });

    const [order, vendor] = await Promise.all([Order.findById(shipment.order).lean(), Vendor.findById(shipment.vendor, 'address').lean()]);
    const lines = order.items.filter((i) => shipment.items.some((r) => String(r.itemId) === String(i._id)));
    const forward = shipment.type === 'forward';
    try {
      const quotes = await provider.rates({
        providerOrderId: shipment.providerOrderId,
        pickupPincode: forward ? vendor.address.pincode : order.shippingAddress.pincode,
        deliveryPincode: forward ? order.shippingAddress.pincode : vendor.address.pincode,
        paymentType: shipment.paymentType,
        shipmentType: shipment.type,
        orderAmount: lines.reduce((s, i) => s + i.lineTotal, 0),
        codAmount: shipment.codAmount,
        package: shipment.package,
      });
      shipment.rateQuotes = quotes;
      shipment.ratesFetchedAt = new Date();
      await shipment.save();
      return quotes;
    } catch (err) {
      throw toApiError(err);
    }
  },

  /**
   * `{ auto: true }` uses Shipmozo's auto-assign rules; otherwise `courierId` must be one of the
   * couriers the rate calculator returned for this shipment (never an arbitrary id).
   */
  async assignCourier(shipmentId, { auto = false, courierId } = {}, actor = SYSTEM) {
    const provider = await shippingProvider.require();
    let quote = null;
    if (!auto) {
      const current = await Shipment.findById(shipmentId, 'rateQuotes ratesFetchedAt').lean();
      if (!current) throw ApiError.notFound('Shipment not found');
      quote = current.rateQuotes?.find((q) => q.courierId === Number(courierId));
      if (!quote || !current.ratesFetchedAt || Date.now() - current.ratesFetchedAt > RATE_QUOTES_TTL_MS) {
        throw ApiError.unprocessable('Pick a courier from a fresh rate quote for this shipment', { code: 'COURIER_NOT_QUOTED' });
      }
    }

    const shipment = await claim(shipmentId, 'assign', ['created']);
    try {
      if (auto) {
        const r = await provider.autoAssign({ providerOrderId: shipment.providerOrderId });
        shipment.courier = { name: r.courier, service: r.courierService };
        shipment.awbNumber = r.awbNumber ?? shipment.awbNumber;
      } else {
        const r = await provider.assignCourier({ providerOrderId: shipment.providerOrderId, courierId: quote.courierId });
        shipment.courier = { id: quote.courierId, name: r.courier ?? quote.name, service: quote.service };
        shipment.awbNumber = r.awbNumber ?? shipment.awbNumber;
        shipment.pickupsAutomaticallyScheduled = quote.pickupsAutomaticallyScheduled ?? undefined;
      }
      shipment.courierAssignedAt = new Date();
      shipment.failedAttempts = 0;
      setStatus(shipment, 'courier_assigned', actor, auto ? 'Auto-assigned' : `Assigned ${shipment.courier.name}`);
      await release(shipment);
      logger.info({ shipmentId: shipment._id, courier: shipment.courier.name, awb: shipment.awbNumber }, 'Courier assigned');
      return shipment;
    } catch (err) {
      await fail(shipment, err, auto ? 'auto_assign' : 'assign');
      throw toApiError(err);
    }
  },

  /** Only for couriers whose pickups aren't scheduled automatically (per the rate calculator). */
  async schedulePickup(shipmentId, actor) {
    const provider = await shippingProvider.require();
    const current = await Shipment.findById(shipmentId, 'pickupsAutomaticallyScheduled').lean();
    if (current?.pickupsAutomaticallyScheduled === true) {
      throw ApiError.conflict('This courier schedules pickups automatically', { code: 'PICKUP_AUTOMATIC' });
    }
    const shipment = await claim(shipmentId, 'pickup', ['courier_assigned']);
    try {
      const r = await provider.schedulePickup({ providerOrderId: shipment.providerOrderId });
      shipment.awbNumber = r.awbNumber ?? shipment.awbNumber;
      shipment.lrNumber = r.lrNumber ?? shipment.lrNumber;
      if (r.courier) shipment.courier.name = r.courier;
      shipment.pickupScheduledAt = new Date();
      setStatus(shipment, 'pickup_scheduled', actor);
      await release(shipment);
      logger.info({ shipmentId: shipment._id, awb: shipment.awbNumber }, 'Pickup scheduled');
      return shipment;
    } catch (err) {
      await fail(shipment, err, 'pickup');
      throw toApiError(err);
    }
  },

  /** Records an AWB issued in the Shipmozo panel when the API didn't return one (e.g. auto-scheduled pickups). */
  async setAwb(shipmentId, awbNumber, actor) {
    const shipment = await claim(shipmentId, 'set_awb', ['courier_assigned', 'pickup_scheduled', 'pickup_pending']);
    shipment.awbNumber = awbNumber;
    shipment.history.push({ status: shipment.status, by: actor, note: `AWB set to ${awbNumber}` });
    await release(shipment);
    return shipment;
  },

  /* ─────────────────────────── Cancellation ─────────────────────────── */

  /**
   * Cancels before pickup. With an AWB the provider must confirm first; local state only changes
   * after it does. Without an AWB (no courier yet) Shipmozo's cancel API can't be used, so the
   * shipment is discarded locally and flagged so the operator can delete the draft in the panel.
   */
  async cancel(shipmentId, { reason } = {}, actor) {
    const provider = await shippingProvider.require();
    const shipment = await claim(shipmentId, 'cancel', ['pending', ...PRE_PICKUP_STATUSES]);
    try {
      let note = reason;
      if (shipment.awbNumber) {
        await provider.cancel({ providerOrderId: shipment.providerOrderId, awbNumber: shipment.awbNumber });
      } else if (shipment.status !== 'pending') {
        note = [reason, 'No AWB yet: remove the draft order from the Shipmozo panel if it is still listed'].filter(Boolean).join('. ');
      }
      shipment.active = false;
      shipment.cancelledAt = new Date();
      setStatus(shipment, 'cancelled', actor, note);
      await release(shipment);
      logger.info({ shipmentId: shipment._id, orderId: shipment.order }, 'Shipment cancelled');
      return shipment;
    } catch (err) {
      await fail(shipment, err, 'cancel');
      throw toApiError(err);
    }
  },

  /* ─────────────────────────── Tracking ─────────────────────────── */

  /** Pulls tracking for one shipment and applies any status change. */
  async refreshTracking(shipmentId, { throwOnError = true } = {}) {
    const provider = await shippingProvider.active();
    const shipment = await Shipment.findById(shipmentId);
    if (!shipment) throw ApiError.notFound('Shipment not found');
    if (!provider || !shipment.awbNumber || TERMINAL_SHIPMENT_STATUSES.includes(shipment.status)) return shipment;

    let t;
    try {
      t = await provider.track(shipment.awbNumber);
    } catch (err) {
      await Shipment.updateOne({ _id: shipment._id }, { 'tracking.lastSyncedAt': new Date() });
      logger.warn({ shipmentId: shipment._id, kind: err.kind }, 'Tracking sync failed');
      if (throwOnError) throw toApiError(err);
      return shipment;
    }

    shipment.tracking = {
      currentStatus: t.currentStatus ?? shipment.tracking?.currentStatus,
      statusTime: t.statusTime ?? undefined,
      expectedDeliveryDate: t.expectedDeliveryDate ?? undefined,
      scans: t.scans,
      lastSyncedAt: new Date(),
    };
    if (t.courier && !shipment.courier?.name) shipment.set('courier.name', t.courier);

    let next = t.status;
    // A return shipment arriving back at the seller is "returned", not "delivered".
    if (shipment.type === 'return' && next === 'delivered') next = 'returned';
    const backwards = PROGRESS.includes(next) && PROGRESS.indexOf(next) < PROGRESS.indexOf(shipment.status);
    const changed = next && !backwards && setStatus(shipment, next, SYSTEM, t.currentStatus);
    if (changed) {
      const now = new Date();
      if (['picked_up', 'in_transit', 'out_for_delivery', 'delivered'].includes(next)) shipment.pickedUpAt ??= now;
      if (next === 'delivered' || next === 'returned') shipment.deliveredAt ??= now;
      if (next === 'cancelled') {
        shipment.cancelledAt ??= now;
        shipment.active = false;
      }
      logger.info(
        { shipmentId: shipment._id, orderId: shipment.order, status: next, providerStatus: t.currentStatus },
        'Shipment status changed',
      );
    }
    await shipment.save();
    if (changed) {
      await syncOrderItems(shipment).catch((err) =>
        logger.error({ err, shipmentId: shipment._id }, 'Could not sync order items from tracking'),
      );
    }
    return shipment;
  },

  /* ─────────────────────────── Returns ─────────────────────────── */

  async returnReasons() {
    const provider = await shippingProvider.require();
    try {
      return await provider.returnReasons();
    } catch (err) {
      throw toApiError(err);
    }
  },

  /**
   * Books a reverse pickup from the customer back to the seller for delivered items.
   * Logistics only: refunds stay a separate, explicit action.
   */
  async createReturn(parentId, { itemIds, returnReasonId, customerRequest, comment }, actor) {
    const provider = await shippingProvider.require();
    const parent = await Shipment.findOne({ _id: parentId, type: 'forward' }).lean();
    if (!parent) throw ApiError.notFound('Shipment not found');
    if (parent.status !== 'delivered')
      throw ApiError.conflict('Returns can be booked once the shipment is delivered', { code: 'INVALID_SHIPMENT_STATE' });

    const order = await Order.findById(parent.order).populate('user', 'email').lean();
    const chosen = itemIds?.length ? itemIds.map(String) : parent.items.map((r) => String(r.itemId));
    const lines = order.items.filter((i) => chosen.includes(String(i._id)) && parent.items.some((r) => String(r.itemId) === String(i._id)));
    if (lines.length !== chosen.length)
      throw ApiError.unprocessable('Some items are not part of this shipment', { code: 'ITEM_NOT_IN_SHIPMENT' });

    const reasons = await this.returnReasons();
    const reason = reasons.find((r) => r.id === returnReasonId);
    if (!reason) throw ApiError.unprocessable('Unknown return reason', { code: 'INVALID_RETURN_REASON' });

    const previous = await Shipment.countDocuments({ parent: parent._id });
    const { defaultPackage } = await settingsService.get('shipping');
    let shipment;
    try {
      shipment = await Shipment.create({
        order: order._id,
        orderNumber: order.orderNumber,
        user: order.user._id,
        vendor: parent.vendor,
        type: 'return',
        parent: parent._id,
        attempt: previous + 1,
        provider: provider.name,
        providerOrderId: `${parent.providerOrderId}-RET${previous + 1}`,
        items: lines.map((i) => ({ itemId: i._id, quantity: i.quantity })),
        paymentType: 'prepaid',
        package: await computePackage(lines, defaultPackage),
        returnInfo: { reasonId: reason.id, reasonTitle: reason.title, customerRequest, comment },
        status: 'pending',
        history: [{ status: 'pending', by: actor }],
      });
    } catch (err) {
      if (err?.code === 11000) throw ApiError.conflict('A return is already open for this shipment', { code: 'RETURN_EXISTS' });
      throw err;
    }

    return this.pushReturn(shipment._id, actor);
  },

  /**
   * Pushes (or retries) a return. Same guarantees as `push`: lock, deterministic id, and
   * verification with get-order-detail when a previous attempt's outcome is unknown.
   */
  async pushReturn(shipmentId, actor = SYSTEM) {
    const provider = await shippingProvider.require();
    const shipment = await claim(shipmentId, 'push', ['pending']);
    try {
      if (shipment.type !== 'return') throw ApiError.conflict('Not a return shipment', { code: 'INVALID_SHIPMENT_STATE' });
      const order = await Order.findById(shipment.order).populate('user', 'email').lean();
      const lines = order.items.filter((i) => shipment.items.some((r) => String(r.itemId) === String(i._id)));
      shipment.warehouseId ??= await ensureWarehouse(provider, shipment.vendor);
      const exists = shipment.needsVerification && (await provider.orderExists(shipment.providerOrderId));
      if (!exists) {
        const r = await provider.pushReturnOrder({
          providerOrderId: shipment.providerOrderId,
          orderDate: order.createdAt,
          pickup: {
            name: order.shippingAddress.name,
            phone: order.shippingAddress.phone,
            email: order.user?.email,
            address: order.shippingAddress,
          },
          items: lines,
          package: shipment.package,
          warehouseId: shipment.warehouseId,
          returnReasonId: shipment.returnInfo.reasonId,
          customerRequest: shipment.returnInfo.customerRequest,
          reasonComment: shipment.returnInfo.comment,
        });
        shipment.referenceId = r.referenceId;
      }
      shipment.needsVerification = false;
      shipment.failedAttempts = 0;
      shipment.pushedAt = new Date();
      setStatus(shipment, 'created', actor, `Return: ${shipment.returnInfo.reasonTitle}`);
      await release(shipment);
      logger.info({ shipmentId: shipment._id, orderId: shipment.order }, 'Return shipment created');
      return shipment;
    } catch (err) {
      await fail(shipment, err, 'push');
      throw toApiError(err);
    }
  },

  /* ─────────────────────────── Labels & warehouses ─────────────────────────── */

  /** Streams the label straight from Shipmozo; labels are not stored (they can be re-fetched by AWB). */
  async label(shipment) {
    const provider = await shippingProvider.require();
    if (!shipment.awbNumber) throw ApiError.conflict('A label is available once an AWB is assigned', { code: 'NO_AWB' });
    try {
      return await provider.label(shipment.awbNumber);
    } catch (err) {
      throw toApiError(err);
    }
  },

  async listWarehouses() {
    const provider = await shippingProvider.require();
    try {
      const [remote, vendors] = await Promise.all([
        provider.warehouses(),
        Vendor.find({ 'shipping.warehouseId': { $exists: true } }, 'store.name shipping.warehouseId').lean(),
      ]);
      const byWarehouse = new Map(vendors.map((v) => [v.shipping.warehouseId, { _id: v._id, storeName: v.store?.name }]));
      return remote.map((w) => ({ ...w, vendor: byWarehouse.get(w.id) ?? null }));
    } catch (err) {
      throw toApiError(err);
    }
  },

  /** Registers (or re-links) a vendor's pickup address as a Shipmozo warehouse. */
  async syncVendorWarehouse(vendorId, { warehouseId } = {}) {
    const provider = await shippingProvider.require();
    try {
      if (warehouseId) {
        const known = (await provider.warehouses()).some((w) => w.id === String(warehouseId));
        if (!known) throw ApiError.unprocessable('That warehouse id does not exist in Shipmozo', { code: 'INVALID_WAREHOUSE' });
        await Vendor.updateOne(
          { _id: vendorId },
          { 'shipping.warehouseId': String(warehouseId), 'shipping.warehouseSyncedAt': new Date() },
        );
        return { warehouseId: String(warehouseId) };
      }
      await Vendor.updateOne({ _id: vendorId }, { $unset: { 'shipping.warehouseId': 1 } });
      return { warehouseId: await ensureWarehouse(provider, vendorId) };
    } catch (err) {
      throw toApiError(err);
    }
  },

  /** Moves an already-pushed shipment to another warehouse (order/update-warehouse). */
  async changeWarehouse(shipmentId, warehouseId, actor) {
    const provider = await shippingProvider.require();
    const shipment = await claim(shipmentId, 'update_warehouse', ['created']);
    try {
      const known = (await provider.warehouses()).some((w) => w.id === String(warehouseId));
      if (!known) throw ApiError.unprocessable('That warehouse id does not exist in Shipmozo', { code: 'INVALID_WAREHOUSE' });
      await provider.updateOrderWarehouse({ providerOrderId: shipment.providerOrderId, warehouseId });
      shipment.warehouseId = String(warehouseId);
      shipment.history.push({ status: shipment.status, by: actor, note: `Warehouse changed to ${warehouseId}` });
      await release(shipment);
      return shipment;
    } catch (err) {
      await fail(shipment, err, 'update_warehouse');
      throw toApiError(err);
    }
  },

  async health() {
    const provider = await shippingProvider.require();
    try {
      await provider.info();
      return { ok: true };
    } catch (err) {
      throw toApiError(err);
    }
  },

  /* ─────────────────────────── Queries ─────────────────────────── */

  forOrder: (orderId, extra = {}) => Shipment.find({ order: orderId, ...extra }).sort({ createdAt: 1 }),

  async get(id, scope = {}) {
    const shipment = await Shipment.findOne({ _id: id, ...scope });
    if (!shipment) throw ApiError.notFound('Shipment not found');
    return shipment;
  },

  /** Customer view: refreshes stale tracking opportunistically; provider failures fall back to stored state. */
  async forCustomer(userId, orderId) {
    const order = await Order.exists({ _id: orderId, user: userId });
    if (!order) throw ApiError.notFound('Order not found');
    const shipments = await Shipment.find({ order: orderId, user: userId, status: { $ne: 'pending' } }).sort({ createdAt: 1 });
    const stale = (s) =>
      TRACKABLE_STATUSES.includes(s.status) && (!s.tracking?.lastSyncedAt || Date.now() - s.tracking.lastSyncedAt > CUSTOMER_REFRESH_MS);
    return Promise.all(shipments.map((s) => (stale(s) ? this.refreshTracking(s._id, { throwOnError: false }) : s)));
  },

  /* ─────────────────────────── Jobs ─────────────────────────── */

  /** Plans and pushes shipments for newly placed orders when auto-create is on; retries failed pushes with backoff. */
  async autoCreate({ limit = 25 } = {}) {
    if (!(await shippingProvider.active())) return 0;
    const { autoCreateShipments } = await settingsService.get('shipping');
    if (!autoCreateShipments) return 0;

    const since = new Date(Date.now() - 14 * 24 * 60 * 60_000);
    const fresh = await Order.aggregate([
      { $match: { status: { $in: SHIPPABLE_ORDER_STATUSES }, createdAt: { $gte: since } } },
      {
        $lookup: {
          from: Shipment.collection.name,
          localField: '_id',
          foreignField: 'order',
          as: 's',
          pipeline: [{ $project: { _id: 1 } }],
        },
      },
      { $match: { s: { $size: 0 } } },
      { $limit: limit },
      { $project: { _id: 1 } },
    ]);
    for (const { _id } of fresh) await this.planForOrder(_id);

    const retryable = await Shipment.find({ type: 'forward', status: 'pending', active: true, failedAttempts: { $lt: MAX_AUTO_RETRIES } })
      .limit(limit)
      .lean();
    let pushed = 0;
    for (const s of retryable) {
      // Exponential backoff: 1, 2, 4, 8 minutes after each failure.
      const waitMs = s.failedAttempts ? 2 ** (s.failedAttempts - 1) * 60_000 : 0;
      if (s.lastError?.at && Date.now() - s.lastError.at < waitMs) continue;
      try {
        await this.push(s._id);
        pushed += 1;
      } catch {
        // already logged and recorded on the shipment
      }
    }
    return pushed;
  },

  /** Polls tracking for shipments that can still change state and haven't been synced recently. */
  async syncTracking({ limit = 50 } = {}) {
    if (!(await shippingProvider.active())) return 0;
    const staleBefore = new Date(Date.now() - TRACKING_STALE_MS);
    const due = await Shipment.find(
      {
        status: { $in: TRACKABLE_STATUSES },
        awbNumber: { $exists: true, $ne: null },
        $or: [{ 'tracking.lastSyncedAt': { $exists: false } }, { 'tracking.lastSyncedAt': { $lt: staleBefore } }],
      },
      '_id',
    )
      .sort({ 'tracking.lastSyncedAt': 1 })
      .limit(limit)
      .lean();
    for (const { _id } of due) await this.refreshTracking(_id, { throwOnError: false });
    return due.length;
  },
};
