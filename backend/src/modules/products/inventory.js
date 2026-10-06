import crypto from 'node:crypto';
import { ApiError } from '#core/errors/ApiError.js';

/**
 * The one place that decides what can be bought and how many.
 * A "sellable" is either a simple product or one of its variants.
 */

export const isTracked = (product) => product.inventory?.trackQuantity !== false;
export const hasVariants = (product) => (product.variants?.length ?? 0) > 0;

export const variantTitle = (product, variant) =>
  (product.variantOptions ?? [])
    .map((o, i) => variant.options[i])
    .filter(Boolean)
    .join(' / ');

/** Units a buyer could take right now; Infinity when quantity isn't tracked. */
export function availableQty(product, variant) {
  if (product.inventory?.available === false) return 0;
  if (variant && variant.available === false) return 0;
  if (!isTracked(product)) return Number.POSITIVE_INFINITY;
  return variant ? (variant.stock ?? 0) : (product.inventory?.stock ?? 0);
}

export function isInStock(product) {
  if (hasVariants(product)) return product.variants.some((v) => availableQty(product, v) > 0);
  return availableQty(product) > 0;
}

/** Units left when the vendor's low-stock alert should show; otherwise null. */
export function lowStockCount(product, variant) {
  const inv = product.inventory ?? {};
  if (!inv.lowStockAlert || !isTracked(product)) return null;
  const qty = availableQty(product, variant);
  return qty > 0 && qty <= (inv.lowStockThreshold ?? 5) ? qty : null;
}

/**
 * Resolves what a cart line is buying. Variant products need a valid variant id;
 * simple products must not get one. Returns the price/stock/SKU that apply.
 */
export function resolveSellable(product, variantId) {
  if (hasVariants(product)) {
    if (!variantId) throw ApiError.unprocessable(`Choose an option for ${product.name}`, { code: 'VARIANT_REQUIRED' });
    const variant = product.variants.find((v) => String(v._id) === String(variantId));
    if (!variant) throw ApiError.unprocessable('That option is no longer available', { code: 'VARIANT_UNAVAILABLE' });
    return {
      variant,
      title: variantTitle(product, variant),
      price: variant.price,
      mrp: variant.mrp,
      sku: variant.sku ?? product.sku,
      image: variant.image?.url ?? product.images?.[0]?.url,
      weightKg: variant.weightKg ?? product.shipping?.weightKg,
      available: availableQty(product, variant),
    };
  }
  if (variantId) throw ApiError.unprocessable('This product has no options', { code: 'VARIANT_UNAVAILABLE' });
  return {
    variant: null,
    title: null,
    price: product.pricing.price,
    mrp: product.pricing.mrp,
    sku: product.sku,
    image: product.images?.[0]?.url,
    weightKg: product.shipping?.weightKg,
    available: availableQty(product),
  };
}

/** "Battery Knapsack Sprayer" → "BAT-KNA-7K2F9Q": readable prefix + random suffix. */
export function generateSku(name) {
  const prefix = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w.slice(0, 3))
    .join('-');
  const suffix = crypto.randomBytes(4).toString('hex').toUpperCase().slice(0, 6);
  return [prefix || 'SKU', suffix].join('-');
}

const optionCode = (value) =>
  String(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 6);

/**
 * Keeps product-level fields consistent with variants (listing price = cheapest variant,
 * stock = sum) and fills any missing SKUs. Call before every save.
 */
export function syncInventory(product) {
  if (!product.sku) product.sku = generateSku(product.name);
  if (!hasVariants(product)) return;

  for (const v of product.variants) {
    if (!v.sku) v.sku = `${product.sku}-${v.options.map(optionCode).filter(Boolean).join('-')}`.slice(0, 64);
  }
  const cheapest = [...product.variants].sort((a, b) => a.price - b.price)[0];
  product.set('pricing.price', cheapest.price);
  product.set('pricing.mrp', cheapest.mrp);
  product.set('inventory.stock', isTracked(product) ? product.variants.reduce((n, v) => n + (v.stock ?? 0), 0) : 0);
}

/** Rules that span fields: option values must match the declared options, combinations unique, SKUs unique. */
export function assertValidVariants(product) {
  const options = product.variantOptions ?? [];
  const variants = product.variants ?? [];
  const details = [];
  if (variants.length && !options.length) details.push({ path: 'variantOptions', message: 'Add at least one option, e.g. Size' });
  if (options.length && !variants.length) details.push({ path: 'variants', message: 'Add at least one variant' });

  const names = new Set();
  options.forEach((o, i) => {
    const key = o.name.toLowerCase();
    if (names.has(key)) details.push({ path: `variantOptions.${i}.name`, message: 'Option names must be different' });
    names.add(key);
    if (new Set(o.values.map((v) => v.toLowerCase())).size !== o.values.length) {
      details.push({ path: `variantOptions.${i}.values`, message: 'Values must be different' });
    }
  });

  const combos = new Set();
  const skus = new Set();
  variants.forEach((v, i) => {
    if (v.options.length !== options.length || v.options.some((val, j) => !options[j]?.values.includes(val))) {
      details.push({ path: `variants.${i}.options`, message: 'Pick a value for every option' });
    }
    const combo = v.options.join('\u0000').toLowerCase();
    if (combos.has(combo)) details.push({ path: `variants.${i}.options`, message: 'This combination is listed twice' });
    combos.add(combo);
    if (v.price > v.mrp) details.push({ path: `variants.${i}.price`, message: 'Price cannot be more than MRP' });
    if (v.sku) {
      if (skus.has(v.sku)) details.push({ path: `variants.${i}.sku`, message: 'SKU already used by another variant' });
      skus.add(v.sku);
    }
  });

  // Bulk tiers and quotes are priced against one base price, which variants don't have.
  if (variants.length && product.bulkPricing?.tiers?.length) {
    details.push({ path: 'bulkPricing.tiers', message: 'Bulk pricing is not available for products with variants' });
  }

  if (details.length) throw ApiError.unprocessable('Check the variants', { code: 'INVALID_VARIANTS', details });
  if (variants.length && product.quotes?.enabled) product.set('quotes.enabled', false);
}
