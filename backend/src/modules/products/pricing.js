import { ApiError } from '#core/errors/ApiError.js';

/**
 * The single place unit prices are decided. Cart, checkout and quotes all go through here,
 * so a buyer can never be charged a price the server didn't compute.
 */

/** Tiers that apply to this buyer, lowest quantity first. */
export function applicableTiers(product, buyer) {
  const tiers = product.bulkPricing?.tiers ?? [];
  if (!tiers.length) return [];
  if (product.bulkPricing.businessOnly && buyer?.accountType !== 'business') return [];
  return [...tiers].sort((a, b) => a.minQty - b.minQty);
}

/**
 * Unit price for a quantity: the deepest tier reached, otherwise the base selling price.
 * `next` describes the following tier so the UI can nudge ("add 3 more to pay ₹X").
 */
export function priceForQuantity(product, quantity, buyer) {
  const basePrice = product.pricing.price;
  const tiers = applicableTiers(product, buyer);
  let tier = null;
  for (const t of tiers) if (quantity >= t.minQty) tier = t;
  const next = tiers.find((t) => t.minQty > quantity);
  return {
    unitPrice: tier ? tier.price : basePrice,
    basePrice,
    tier: tier ? { minQty: tier.minQty, price: tier.price } : null,
    next: next ? { minQty: next.minQty, price: next.price, unitsNeeded: next.minQty - quantity } : null,
  };
}

/**
 * Smallest quantity a buyer can request a quote for. Defaults to the top tier (or 10× the
 * MOQ, at least 10) so quotes are used for genuinely large orders, not to dodge the tiers.
 */
export function quoteThreshold(product) {
  if (product.quotes?.minQty) return Math.max(product.quotes.minQty, product.inventory?.moq ?? 1);
  const tiers = product.bulkPricing?.tiers ?? [];
  if (tiers.length) return Math.max(...tiers.map((t) => t.minQty));
  return Math.max(10, (product.inventory?.moq ?? 1) * 10);
}

/**
 * Enforces the tier rules against the product's effective price/MOQ/max quantity.
 * Tiers must step up in quantity and down in price, all below the base price.
 */
export function assertValidBulkPricing(product) {
  const tiers = product.bulkPricing?.tiers ?? [];
  if (!tiers.length) return;
  const { price } = product.pricing;
  const { moq = 1, maxOrderQty } = product.inventory ?? {};
  const details = [];
  let prevQty = moq;
  let prevPrice = price;

  tiers.forEach((t, i) => {
    if (t.minQty <= prevQty) {
      details.push({
        path: `bulkPricing.tiers.${i}.minQty`,
        message: i === 0 ? `Must be more than the minimum order quantity (${moq})` : 'Must be more than the previous tier',
      });
    }
    if (maxOrderQty && t.minQty > maxOrderQty) {
      details.push({ path: `bulkPricing.tiers.${i}.minQty`, message: `Cannot exceed the max per order (${maxOrderQty})` });
    }
    if (t.price >= prevPrice) {
      details.push({
        path: `bulkPricing.tiers.${i}.price`,
        message: i === 0 ? 'Must be lower than the selling price' : 'Must be lower than the previous tier',
      });
    }
    prevQty = t.minQty;
    prevPrice = t.price;
  });

  if (details.length) {
    throw ApiError.unprocessable('Check the bulk pricing tiers', { code: 'INVALID_BULK_PRICING', details });
  }
}

/** Card/listing summary: the best per-unit price and where it starts. */
export function bulkSummary(product) {
  const tiers = product.bulkPricing?.tiers ?? [];
  if (!tiers.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const best = sorted.at(-1);
  return {
    tiers: sorted.map(({ minQty, price }) => ({ minQty, price })),
    fromPrice: best.price,
    startsAt: sorted[0].minQty,
    businessOnly: Boolean(product.bulkPricing.businessOnly),
  };
}
