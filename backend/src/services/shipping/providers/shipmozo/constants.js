/** Endpoints exactly as documented in the Shipmozo API guide (relative to SHIPMOZO_BASE_URL). */
export const ENDPOINTS = {
  info: '/info',
  pushOrder: '/push-order',
  pushReturnOrder: '/push-return-order',
  assignCourier: '/assign-courier',
  schedulePickup: '/schedule-pickup',
  cancelOrder: '/cancel-order',
  autoAssignOrder: '/auto-assign-order',
  orderDetail: (orderId) => `/get-order-detail/${encodeURIComponent(orderId)}`,
  rateCalculator: '/rate-calculator',
  pincodeServiceability: '/pincode-serviceability',
  returnReasons: '/get-return-reason',
  orderLabel: (awb) => `/get-order-label/${encodeURIComponent(awb)}`,
  trackOrder: '/track-order',
  createWarehouse: '/create-warehouse',
  updateOrderWarehouse: '/order/update-warehouse',
  warehouses: '/get-warehouses',
};

export const PAYMENT_TYPE = { prepaid: 'PREPAID', cod: 'COD' };
export const SHIPMENT_TYPE = { forward: 'FORWARD', return: 'RETURN' };
export const DEFAULT_PACKAGE_TYPE = 'SPS';
export const DEFAULT_ROV_TYPE = 'ROV_OWNER';
export const DEFAULT_ORDER_TYPE = 'NON ESSENTIALS';
export const CUSTOMER_REQUESTS = ['REFUND', 'EXCHANGE'];

/**
 * Shipmozo's `current_status` values are free text (e.g. "Pickup Pending").
 * They are matched in order; the first rule that matches wins.
 */
export const TRACKING_STATUS_RULES = [
  [/cancel/i, 'cancelled'],
  [/\brto\b.*deliver|return(ed)?\s*(to origin|delivered)|rto delivered/i, 'returned'],
  [/\brto\b|return/i, 'return_in_transit'],
  [/out\s*for\s*delivery/i, 'out_for_delivery'],
  [/undeliver|not\s*delivered|failed|lost|damage|exception/i, 'exception'],
  [/deliver/i, 'delivered'],
  [/pickup\s*(pending|scheduled|generated)|pending\s*pickup|manifest|not\s*picked|awb\s*assigned|ready\s*to\s*ship/i, 'pickup_pending'],
  [/picked|pickup\s*(done|complete)/i, 'picked_up'],
  [/transit|dispatch|shipped|reached|arrived|connected|in\s*hub|forwarded/i, 'in_transit'],
];
