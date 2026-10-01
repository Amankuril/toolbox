/**
 * The API speaks integer paise everywhere. Convert only at the edges (display & inputs).
 */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2, minimumFractionDigits: 0 })
const inrWhole = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 })
const compact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 })

export const toPaise = (rupees) => Math.round(Number(rupees) * 100)
export const fromPaise = (paise) => Math.round(Number(paise ?? 0)) / 100

/** ₹3,49,900 — drops paise when they're zero. */
export function formatINR(paise, { whole = false } = {}) {
  const rupees = fromPaise(paise)
  return (whole || Number.isInteger(rupees) ? inrWhole : inr).format(rupees)
}

export function formatCompactINR(paise) {
  return `₹${compact.format(fromPaise(paise))}`
}

export function formatNumber(n) {
  return new Intl.NumberFormat('en-IN').format(n ?? 0)
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' })

export const formatDate = (d) => (d ? dateFmt.format(new Date(d)) : '—')
export const formatDateTime = (d) => (d ? dateTimeFmt.format(new Date(d)) : '—')

const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
export function formatRelative(d) {
  if (!d) return '—'
  const diff = (new Date(d).getTime() - Date.now()) / 1000
  const steps = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.35, 'week'],
    [12, 'month'],
    [Infinity, 'year'],
  ]
  let value = diff
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return rtf.format(Math.round(value), unit)
    value /= size
  }
  return formatDate(d)
}

/** "+91 98765 43210" */
export function formatPhone(e164) {
  const m = /^\+91(\d{5})(\d{5})$/.exec(e164 ?? '')
  return m ? `+91 ${m[1]} ${m[2]}` : (e164 ?? '')
}

export const titleCase = (s) =>
  String(s ?? '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())

export function pluralize(n, one, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`
}
