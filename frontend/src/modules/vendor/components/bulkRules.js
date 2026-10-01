export const MAX_TIERS = 5

/**
 * Same rules the API enforces, run in the form for instant feedback:
 * quantities step up from the MOQ, prices step down from the selling price.
 */
export function bulkTierIssues(tiers, { basePrice, moq }) {
  const issues = []
  let prevQty = moq ?? 1
  let prevPrice = basePrice
  tiers.forEach((t, i) => {
    if (t.minQty != null && t.minQty <= prevQty) {
      issues.push({ index: i, field: 'minQty', message: i === 0 ? `More than the min. order (${prevQty})` : 'More than the tier above' })
    }
    if (t.price != null && prevPrice != null && t.price >= prevPrice) {
      issues.push({ index: i, field: 'price', message: i === 0 ? 'Lower than the selling price' : 'Lower than the tier above' })
    }
    prevQty = t.minQty ?? prevQty
    prevPrice = t.price ?? prevPrice
  })
  return issues
}
