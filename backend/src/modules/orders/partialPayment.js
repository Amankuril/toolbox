/**
 * Partial payment ("advance + balance on delivery"): the buyer pays a share online now and the
 * courier collects the rest in cash. All amounts in paise.
 */

/** Advance rounded up to a whole rupee, so the cash balance is a round-ish figure for the courier. */
export function splitPartial(total, percent) {
  const advance = Math.min(total, Math.max(100, Math.ceil((total * percent) / 100 / 100) * 100));
  return { advance, balanceDue: total - advance };
}

/** What the gateway should charge for this order right now. */
export const onlineAmount = (order) => (order.payment?.method === 'partial' ? order.amounts.advance : order.amounts.total);

/** Online payment confirmed (in full, or the advance). */
export const PAID_ONLINE = ['paid', 'partially_paid', 'partially_refunded', 'refunded'];

/**
 * Splits `amount` across `weights` exactly (largest remainder), so per-parcel COD amounts
 * always add up to the balance to the paisa.
 */
export function allocate(amount, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map((_, i) => (i === 0 ? amount : 0));
  const raw = weights.map((w) => (amount * w) / sum);
  const out = raw.map(Math.floor);
  let left = amount - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left -= 1) out[order[k][1]] += 1;
  return out;
}
