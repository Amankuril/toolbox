export const INDIAN_STATES = [
  'Andaman and Nicobar Islands',
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chandigarh',
  'Chhattisgarh',
  'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jammu and Kashmir',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Ladakh',
  'Lakshadweep',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
]

export const PRODUCT_TYPES = [
  { value: 'tool', label: 'Tool', hint: 'Hand & power tools' },
  { value: 'machinery', label: 'Machinery', hint: 'Machines & equipment' },
  { value: 'part', label: 'Spare part', hint: 'Parts & accessories' },
]
export const PRODUCT_TYPE_LABEL = Object.fromEntries(PRODUCT_TYPES.map((t) => [t.value, t.label]))

export const PRODUCT_CONDITIONS = [
  { value: 'new', label: 'New' },
  { value: 'refurbished', label: 'Refurbished' },
  { value: 'used', label: 'Used' },
]

export const PRODUCT_UNITS = ['piece', 'set', 'pair', 'box', 'pack', 'kg', 'litre', 'metre', 'roll']
export const GST_RATES = [0, 5, 12, 18, 28]

export const BUSINESS_TYPES = [
  { value: 'proprietorship', label: 'Proprietorship' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'llp', label: 'LLP' },
  { value: 'private_limited', label: 'Private Limited' },
  { value: 'public_limited', label: 'Public Limited' },
  { value: 'other', label: 'Other' },
]

export const VENDOR_DOCUMENTS = [
  { value: 'gst_certificate', label: 'GST certificate', required: true },
  { value: 'cancelled_cheque', label: 'Cancelled cheque', required: true },
  { value: 'pan_card', label: 'PAN card' },
  { value: 'business_proof', label: 'Business proof' },
]

/** Status → badge tone. Tones map to styles in ui/Badge. */
export const STATUS_TONES = {
  // vendor
  onboarding: 'neutral',
  pending_review: 'warning',
  approved: 'success',
  rejected: 'danger',
  suspended: 'danger',
  // product / category
  draft: 'neutral',
  pending: 'warning',
  active: 'success',
  inactive: 'neutral',
  archived: 'neutral',
  // user
  blocked: 'danger',
  // order
  pending_payment: 'warning',
  placed: 'info',
  processing: 'info',
  completed: 'success',
  cancelled: 'danger',
  // order item
  confirmed: 'info',
  packed: 'info',
  shipped: 'info',
  delivered: 'success',
  // quotes (rfq)
  requested: 'warning',
  quoted: 'info',
  accepted: 'success',
  ordered: 'success',
  declined: 'danger',
  withdrawn: 'neutral',
  expired: 'neutral',
  // payment
  paid: 'success',
  failed: 'danger',
  refunded: 'neutral',
  partially_refunded: 'warning',
  // shipment
  created: 'info',
  courier_assigned: 'info',
  pickup_scheduled: 'info',
  pickup_pending: 'warning',
  picked_up: 'info',
  in_transit: 'info',
  out_for_delivery: 'primary',
  exception: 'danger',
  return_in_transit: 'warning',
  returned: 'neutral',
}

export const QUOTE_STATUS_LABELS = {
  requested: 'Awaiting quote',
  quoted: 'Quote received',
  accepted: 'Accepted',
  ordered: 'Ordered',
  declined: 'Declined by seller',
  rejected: 'Declined by buyer',
  withdrawn: 'Withdrawn',
  expired: 'Expired',
}

export const STATUS_LABELS = {
  pending_review: 'Under review',
  pending_payment: 'Awaiting payment',
  partially_refunded: 'Part refunded',
  pending: 'Pending',
  courier_assigned: 'Courier assigned',
  pickup_scheduled: 'Pickup scheduled',
  pickup_pending: 'Awaiting pickup',
  picked_up: 'Picked up',
  in_transit: 'In transit',
  out_for_delivery: 'Out for delivery',
  exception: 'Delivery issue',
  return_in_transit: 'Returning to seller',
}

export const SHIPMENT_STATUS_LABELS = { pending: 'Not booked', created: 'Booked' }

export const PAYMENT_METHOD_LABEL = { razorpay: 'Paid online (Razorpay)', cod: 'Cash on delivery' }

/** First two digits of a GSTIN identify the state. Used to pre-fill addresses. */
export const GST_STATE_CODES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  10: 'Bihar',
  11: 'Sikkim',
  12: 'Arunachal Pradesh',
  13: 'Nagaland',
  14: 'Manipur',
  15: 'Mizoram',
  16: 'Tripura',
  17: 'Meghalaya',
  18: 'Assam',
  19: 'West Bengal',
  20: 'Jharkhand',
  21: 'Odisha',
  22: 'Chhattisgarh',
  23: 'Madhya Pradesh',
  24: 'Gujarat',
  26: 'Dadra and Nagar Haveli and Daman and Diu',
  27: 'Maharashtra',
  29: 'Karnataka',
  30: 'Goa',
  31: 'Lakshadweep',
  32: 'Kerala',
  33: 'Tamil Nadu',
  34: 'Puducherry',
  35: 'Andaman and Nicobar Islands',
  36: 'Telangana',
  37: 'Andhra Pradesh',
  38: 'Ladakh',
}
