import { z } from 'zod';

/**
 * Delivery charges by order value, as slabs with a flat fee each. All amounts are in paise.
 *
 *   [{ from: 0, to: 200000, fee: 20000 }, { from: 200000, to: 500000, fee: 40000 }]
 *   ₹0 up to ₹2,000 → ₹200 · ₹2,000 up to ₹5,000 → ₹400 · above ₹5,000 → ₹400 (the last slab's fee)
 *
 * Rules: the first slab starts at ₹0, each next slab starts at the previous slab's `to`, and every slab ends
 * above where it starts — so slabs never overlap or leave gaps. A slab covers `from` up to, not including,
 * `to` (an order of exactly ₹2,000 is in the slab that starts at ₹2,000). Orders above the last slab pay the
 * last slab's fee. No slabs at all means delivery is free on every order.
 */
export const MAX_DELIVERY_SLABS = 20;
export const MAX_SLAB_AMOUNT = 1_000_000_000; // ₹1 crore

const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

const slab = z.object({
  from: z.number().int().min(0).max(MAX_SLAB_AMOUNT),
  to: z.number().int().min(1).max(MAX_SLAB_AMOUNT),
  fee: z.number().int().min(0).max(MAX_SLAB_AMOUNT),
});

export const deliverySlabsSchema = z
  .array(slab)
  .max(MAX_DELIVERY_SLABS, `Up to ${MAX_DELIVERY_SLABS} delivery slabs`)
  .superRefine((slabs, ctx) => {
    slabs.forEach((s, i) => {
      const start = i === 0 ? 0 : slabs[i - 1].to;
      if (s.from !== start) {
        ctx.addIssue({
          code: 'custom',
          path: [i, 'from'],
          message: i === 0 ? 'The first slab must start from ₹0' : `Slab ${i + 1} must start from ${rupees(start)}, where slab ${i} ends`,
        });
      }
      if (s.to <= s.from) {
        ctx.addIssue({ code: 'custom', path: [i, 'to'], message: `Slab ${i + 1} must end above ${rupees(s.from)}` });
      }
    });
  });

/** The delivery fee for an order value (items after coupon discount). An empty order is never charged. */
export function deliveryFee(orderValue, slabs) {
  if (!(orderValue > 0) || !slabs?.length) return 0;
  return (slabs.find((s) => orderValue >= s.from && orderValue < s.to) ?? slabs.at(-1)).fee;
}

/**
 * Brings older shipping settings to slabs: the original flat fee + free-above amount, and the short-lived
 * open-ended `{ upTo, fee }` slabs. Returns slabs unchanged when they're already in the current shape.
 */
export function normaliseSlabs(shipping = {}) {
  const { deliverySlabs, flatFee = 0, freeAbove = 0 } = shipping;
  if (Array.isArray(deliverySlabs)) {
    if (!deliverySlabs.some((s) => 'upTo' in s)) return deliverySlabs;
    return deliverySlabs.map((s, i) => ({
      from: i === 0 ? 0 : deliverySlabs[i - 1].upTo,
      to: s.upTo ?? Math.max(MAX_SLAB_AMOUNT, (deliverySlabs[i - 1]?.upTo ?? 0) + 100),
      fee: s.fee,
    }));
  }
  if (!flatFee) return [];
  if (freeAbove > 0 && freeAbove < MAX_SLAB_AMOUNT) {
    return [
      { from: 0, to: freeAbove, fee: flatFee },
      { from: freeAbove, to: MAX_SLAB_AMOUNT, fee: 0 },
    ];
  }
  return [{ from: 0, to: MAX_SLAB_AMOUNT, fee: flatFee }];
}
