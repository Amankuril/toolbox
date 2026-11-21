/**
 * Delivery charges by order value (mirrors backend modules/shipping/delivery.slabs.js). Amounts in paise.
 * Slabs are { from, to, fee }: the first starts at ₹0, each next one at the previous `to`. A slab covers `from`
 * up to, not including, `to`; orders above the last slab pay its fee. No slabs = free delivery.
 */

/** The delivery fee for an order value (items after coupon discount). */
export function deliveryFee(orderValue, slabs) {
  if (!(orderValue > 0) || !slabs?.length) return 0
  return (slabs.find((s) => orderValue >= s.from && orderValue < s.to) ?? slabs.at(-1)).fee
}

/** Index of the slab an order value falls in (the last one for anything above it). */
function slabIndex(orderValue, slabs) {
  const i = slabs.findIndex((s) => orderValue >= s.from && orderValue < s.to)
  return i === -1 ? slabs.length - 1 : i
}

/** Order value from which delivery is free for good: 0 = every order, null = never free. */
export function freeDeliveryFrom(slabs) {
  if (!slabs?.length || slabs.every((s) => s.fee === 0)) return 0
  if (slabs.at(-1).fee !== 0) return null
  let i = slabs.length - 1
  while (i > 0 && slabs[i - 1].fee === 0) i -= 1
  return slabs[i].from
}

/**
 * The nearest higher slab that costs less than the current one, for "add ₹X more" nudges.
 * Returns { at, fee, current } (at = order value where it starts) or null when nothing cheaper is ahead.
 */
export function nextCheaperSlab(orderValue, slabs) {
  if (!slabs?.length) return null
  const idx = slabIndex(orderValue, slabs)
  const current = slabs[idx].fee
  const next = slabs.slice(idx + 1).find((s) => s.fee < current)
  return next ? { at: next.from, fee: next.fee, current } : null
}
