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
  // payment
  paid: 'success',
  failed: 'danger',
  refunded: 'neutral',
  partially_refunded: 'warning',
}

export const STATUS_LABELS = {
  pending_review: 'Under review',
  pending_payment: 'Awaiting payment',
  partially_refunded: 'Part refunded',
  pending: 'Pending',
}
