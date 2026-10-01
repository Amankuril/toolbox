/**
 * Display-side mirror of backend/src/modules/products/pricing.js. The server still prices
 * every cart and order; this only drives live previews (product page table, guest cart).
 */

/** Tiers usable by this buyer, lowest quantity first. */
export function usableTiers(bulk, { isBusiness = false } = {}) {
  const tiers = bulk?.tiers ?? []
  if (!tiers.length || (bulk.businessOnly && !isBusiness)) return []
  return [...tiers].sort((a, b) => a.minQty - b.minQty)
}

export function priceFor(basePrice, tiers, quantity) {
  let tier = null
  for (const t of tiers) if (quantity >= t.minQty) tier = t
  const next = tiers.find((t) => t.minQty > quantity) ?? null
  return { unitPrice: tier ? tier.price : basePrice, tier, next: next && { ...next, unitsNeeded: next.minQty - quantity } }
}

/** Rows for a "quantity → price per unit" table, starting at the MOQ with the base price. */
export function tierRows(basePrice, moq, tiers) {
  const points = [{ minQty: moq, price: basePrice }, ...tiers]
  return points.map((p, i) => ({
    ...p,
    maxQty: points[i + 1] ? points[i + 1].minQty - 1 : null,
    savePercent: basePrice > p.price ? Math.round(((basePrice - p.price) / basePrice) * 100) : 0,
    isBase: i === 0,
  }))
}

export const rangeLabel = (row, unit = 'pc') => (row.maxQty ? (row.maxQty === row.minQty ? `${row.minQty}` : `${row.minQty}–${row.maxQty}`) : `${row.minQty}+`) + ` ${unit}`
