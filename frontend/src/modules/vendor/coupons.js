import { formatDate, formatINR } from '@/core/lib/format'

/** "10% off (up to ₹600)" / "₹500 off" */
export function couponOffer(c) {
  if (c.type === 'percent') return `${c.value}% off${c.maxDiscount ? ` (up to ${formatINR(c.maxDiscount, { whole: true })})` : ''}`
  return `${formatINR(c.value, { whole: true })} off`
}

/** "Min. ₹2,000 · till 31 Dec 2026" */
export function couponConditions(c) {
  return [c.minOrderValue ? `Min. ${formatINR(c.minOrderValue, { whole: true })}` : 'No minimum', c.expiresAt ? `till ${formatDate(c.expiresAt)}` : null]
    .filter(Boolean)
    .join(' · ')
}

export const COUPON_STATES = {
  live: { label: 'Live', tone: 'success' },
  not_started: { label: 'Scheduled', tone: 'info' },
  expired: { label: 'Expired', tone: 'neutral' },
  limit_reached: { label: 'Used up', tone: 'warning' },
  inactive: { label: 'Off', tone: 'neutral' },
}
