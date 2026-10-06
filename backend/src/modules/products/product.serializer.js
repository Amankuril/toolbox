import { availableQty, hasVariants, isInStock, isTracked, lowStockCount, variantTitle } from './inventory.js';
import { bulkSummary, quoteThreshold } from './pricing.js';

export const CARD_FIELDS =
  'name slug type brand modelNumber condition images pricing inventory isFeatured vendor bulkPricing specifications shipping variantOptions variants rating';

/** Stars to show: nothing until a product has a published review. */
const ratingOf = (p) => (p.rating?.count ? { average: p.rating.average, count: p.rating.count } : null);

/** Finite stock, or null when quantity isn't tracked (unlimited while available). */
const finite = (n) => (Number.isFinite(n) ? n : null);

/** Buyer-facing variant: what to show and whether it can be bought. */
function publicVariant(p, v) {
  const qty = availableQty(p, v);
  return {
    _id: v._id,
    options: v.options,
    title: variantTitle(p, v),
    price: v.price,
    mrp: v.mrp,
    discountPercent: discount(v.mrp, v.price),
    image: v.image ?? null,
    inStock: qty > 0,
    stock: finite(qty),
    lowStock: lowStockCount(p, v),
  };
}

const discount = (mrp, price) => (mrp > price ? Math.round(((mrp - price) / mrp) * 100) : 0);

/** Compact shape for grids and carousels. */
export function serializeProductCard(p) {
  if (!p) return null;
  return {
    _id: p._id,
    name: p.name,
    slug: p.slug,
    type: p.type,
    brand: p.brand ?? null,
    condition: p.condition,
    image: p.images?.[0] ?? null,
    price: p.pricing.price,
    mrp: p.pricing.mrp,
    discountPercent: discount(p.pricing.mrp, p.pricing.price),
    inStock: isInStock(p),
    stock: hasVariants(p) ? null : finite(availableQty(p)),
    lowStock: hasVariants(p) ? null : lowStockCount(p),
    hasVariants: hasVariants(p),
    variantOptions: (p.variantOptions ?? []).map(({ name, values }) => ({ name, values })),
    variants: (p.variants ?? []).map((v) => publicVariant(p, v)),
    moq: p.inventory?.moq ?? 1,
    maxOrderQty: p.inventory?.maxOrderQty ?? null,
    unit: p.inventory?.unit ?? 'piece',
    modelNumber: p.modelNumber ?? null,
    // First specs double as the "key facts" line on cards.
    highlights: (p.specifications ?? []).slice(0, 3).map(({ label, value }) => ({ label, value })),
    dispatchDays: p.shipping?.dispatchDays ?? null,
    bulk: bulkSummary(p),
    rating: ratingOf(p),
    isFeatured: Boolean(p.isFeatured),
  };
}

/** Full product for the owning vendor and admins. */
export function serializeProduct(p) {
  if (!p) return null;
  return {
    _id: p._id,
    vendor: p.vendor,
    category: p.category,
    categoryPath: p.categoryPath,
    type: p.type,
    name: p.name,
    slug: p.slug,
    sku: p.sku ?? null,
    barcode: p.barcode ?? null,
    brand: p.brand ?? null,
    modelNumber: p.modelNumber ?? null,
    shortDescription: p.shortDescription ?? null,
    description: p.description ?? null,
    images: p.images ?? [],
    pricing: { ...p.pricing, discountPercent: discount(p.pricing.mrp, p.pricing.price) },
    hsnCode: p.hsnCode ?? null,
    inventory: {
      ...p.inventory,
      trackQuantity: isTracked(p),
      available: p.inventory?.available !== false,
      lowStockAlert: Boolean(p.inventory?.lowStockAlert),
      lowStockThreshold: p.inventory?.lowStockThreshold ?? 5,
    },
    variantOptions: (p.variantOptions ?? []).map(({ name, values }) => ({ name, values })),
    variants: (p.variants ?? []).map((v) => ({
      _id: v._id,
      options: v.options,
      title: variantTitle(p, v),
      price: v.price,
      mrp: v.mrp,
      sku: v.sku ?? null,
      barcode: v.barcode ?? null,
      stock: v.stock ?? 0,
      available: v.available !== false,
      weightKg: v.weightKg ?? null,
      image: v.image ?? null,
    })),
    bulkPricing: { tiers: p.bulkPricing?.tiers ?? [], businessOnly: Boolean(p.bulkPricing?.businessOnly) },
    quotes: { enabled: p.quotes?.enabled ?? true, minQty: p.quotes?.minQty ?? null, threshold: quoteThreshold(p) },
    specifications: p.specifications ?? [],
    condition: p.condition,
    warranty: p.warranty ?? null,
    shipping: p.shipping ?? null,
    compatibleWith: p.compatibleWith ?? [],
    compatibleModels: p.compatibleModels ?? [],
    tags: p.tags ?? [],
    status: p.status,
    moderation: p.moderation ?? null,
    isFeatured: Boolean(p.isFeatured),
    vendorApproved: p.vendorApproved,
    seo: p.seo ?? null,
    publishedAt: p.publishedAt ?? null,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

/** Storefront product page: no moderation or internal flags. */
export function serializePublicProduct(p) {
  const { moderation: _m, vendorApproved: _v, status: _s, categoryPath: _c, barcode: _b, ...rest } = serializeProduct(p);
  const simpleQty = hasVariants(p) ? 0 : availableQty(p);
  return {
    ...rest,
    // Internal counts/codes stay private; buyers get availability, plus a count only when it's low.
    inventory: {
      moq: p.inventory?.moq ?? 1,
      maxOrderQty: p.inventory?.maxOrderQty ?? null,
      unit: p.inventory?.unit ?? 'piece',
      stock: hasVariants(p) ? null : finite(simpleQty),
    },
    variants: (p.variants ?? []).map((v) => publicVariant(p, v)),
    inStock: isInStock(p),
    lowStock: hasVariants(p) ? null : lowStockCount(p),
    hasVariants: hasVariants(p),
    rating: ratingOf(p),
  };
}
