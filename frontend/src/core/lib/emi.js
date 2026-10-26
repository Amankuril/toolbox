/**
 * EMI on a reducing balance, the way Indian banks quote card EMI: amount in paise, yearly rate in percent.
 * Returns the monthly instalment rounded up to a rupee, and the totals.
 */
export function emi(amount, months, yearlyRate) {
  const r = yearlyRate / 12 / 100
  const raw = r === 0 ? amount / months : (amount * r * (1 + r) ** months) / ((1 + r) ** months - 1)
  const monthly = Math.ceil(raw / 100) * 100
  // No-cost EMI: the rounding goes to the last instalment, not to "interest".
  if (r === 0) return { months, rate: 0, monthly, total: amount, interest: 0 }
  const total = monthly * months
  return { months, rate: yearlyRate, monthly, total, interest: Math.max(0, total - amount) }
}

/** Every plan from Settings → Payments for this amount; no-cost tenures at 0% interest. Empty when EMI isn't offered for it. */
export function emiPlans(amount, payments) {
  if (!payments?.emiEnabled || !amount || amount < (payments.emiMinOrderValue ?? 0)) return []
  const noCost = new Set(payments.noCostMonths ?? [])
  return [...(payments.emiPlans ?? [])]
    .sort((a, b) => a.months - b.months)
    .map((p) => ({ ...emi(amount, p.months, noCost.has(p.months) ? 0 : p.rate), noCost: noCost.has(p.months) }))
}

/** The smallest monthly instalment on offer: "EMI from ₹X/month". */
export function lowestEmi(amount, payments) {
  const plans = emiPlans(amount, payments)
  return plans.length ? plans.reduce((low, p) => (p.monthly < low.monthly ? p : low)) : null
}
