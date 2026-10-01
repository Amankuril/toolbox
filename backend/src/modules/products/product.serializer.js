import { bulkSummary, quoteThreshold } from './pricing.js';

export const CARD_FIELDS = 'name slug type brand modelNumber condition images pricing inventory isFeatured vendor bulkPricing specifications shipping';

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
    inStock: (p.inventory?.stock ?? 0) > 0,
    stock: p.inventory?.stock ?? 0,
    moq: p.inventory?.moq ?? 1,
    maxOrderQty: p.inventory?.maxOrderQty ?? null,
    unit: p.inventory?.unit ?? 'piece',
    modelNumber: p.modelNumber ?? null,
    // First specs double as the "key facts" line on cards.
    highlights: (p.specifications ?? []).slice(0, 3).map(({ label, value }) => ({ label, value })),
    dispatchDays: p.shipping?.dispatchDays ?? null,
    bulk: bulkSummary(p),
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
    brand: p.brand ?? null,
    modelNumber: p.modelNumber ?? null,
    shortDescription: p.shortDescription ?? null,
    description: p.description ?? null,
    images: p.images ?? [],
    pricing: { ...p.pricing, discountPercent: discount(p.pricing.mrp, p.pricing.price) },
    hsnCode: p.hsnCode ?? null,
    inventory: p.inventory,
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
  const { moderation: _m, vendorApproved: _v, status: _s, categoryPath: _c, ...rest } = serializeProduct(p);
  return { ...rest, inStock: (p.inventory?.stock ?? 0) > 0 };
}
