/**
 * All monetary values in the system are integers in paise (1 INR = 100 paise).
 * These helpers are the only place conversions should happen.
 */
export const toPaise = (rupees) => Math.round(Number(rupees) * 100);
export const toRupees = (paise) => Math.round(Number(paise)) / 100;

/** GST contained inside a GST-inclusive price, rounded to the nearest paisa. */
export function gstFromInclusive(inclusivePaise, ratePercent) {
  if (!ratePercent) return 0;
  return Math.round(inclusivePaise - inclusivePaise / (1 + ratePercent / 100));
}
