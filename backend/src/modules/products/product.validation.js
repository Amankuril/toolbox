import { z } from 'zod';
import { paginationQuery } from '#core/utils/pagination.js';
import { hsnCode, idParams, imageInput, nonEmpty, objectId, optionalText, queryBool, videoInput } from '#core/validation/common.js';
import {
  GST_RATES,
  MAX_BULK_TIERS,
  MAX_OPTION_VALUES,
  MAX_PRODUCT_IMAGES,
  MAX_PRODUCT_VIDEOS,
  MAX_VARIANT_OPTIONS,
  MAX_VARIANTS,
  MEDIA_KINDS,
  PRODUCT_CONDITIONS,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  PRODUCT_UNITS,
} from './product.model.js';

/** Paise; capped at ₹10 crore to catch unit mistakes (rupees sent as paise × 100). */
const money = z.number().int('Amount must be in paise (whole number)').min(0).max(1_000_000_000);
const nonNegative = (max) => z.number().min(0).max(max);

export const gstRate = z.union(
  GST_RATES.map((r) => z.literal(r)),
  { error: `GST rate must be one of ${GST_RATES.join(', ')}` },
);

const pricing = z
  .object({
    mrp: money.min(1, 'MRP is required'),
    price: money.min(1, 'Selling price is required'),
    // null or left out: use the category's rate.
    gstRate: gstRate.nullish(),
  })
  .refine((p) => p.price <= p.mrp, { path: ['price'], message: 'Selling price cannot be more than MRP' });

const inventory = z
  .object({
    trackQuantity: z.boolean().default(true),
    available: z.boolean().default(true),
    // Ignored when quantity isn't tracked, or derived from variants when there are any.
    stock: z.number().int().min(0).max(1_000_000).default(0),
    lowStockAlert: z.boolean().default(false),
    lowStockThreshold: z.number().int().min(1).max(100_000).default(5),
    moq: z.number().int().min(1).max(100_000).default(1),
    maxOrderQty: z.number().int().min(1).max(100_000).optional(),
    unit: z.enum(PRODUCT_UNITS).default('piece'),
  })
  .refine((i) => !i.maxOrderQty || i.maxOrderQty >= i.moq, {
    path: ['maxOrderQty'],
    message: 'Must be at least the minimum order quantity',
  });

/**
 * Shape only; the rules that depend on price/MOQ (ascending quantities, descending prices)
 * are enforced in the service against the product's effective values.
 */
const bulkPricing = z.object({
  tiers: z
    .array(
      z.object({
        minQty: z.number().int().min(2, 'Bulk tiers start at 2 units or more').max(1_000_000),
        price: money.min(1, 'Enter a price per unit'),
      }),
    )
    .max(MAX_BULK_TIERS, `Up to ${MAX_BULK_TIERS} bulk tiers`),
  businessOnly: z.boolean().default(false),
});

/** UPC-A (12), EAN-8/13, GTIN-14 or ISBN-10/13. */
export const barcode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^(\d{8}|\d{12,14}|\d{9}[\dX])$/, 'Enter a valid barcode (UPC, EAN, GTIN or ISBN)');
const optionalBarcode = barcode.optional().or(z.literal('').transform(() => undefined));

const variantOptions = z
  .array(
    z.object({
      name: nonEmpty(40),
      values: z.array(nonEmpty(60)).min(1, 'Add at least one value').max(MAX_OPTION_VALUES),
    }),
  )
  .max(MAX_VARIANT_OPTIONS, `Up to ${MAX_VARIANT_OPTIONS} options`);

const variants = z
  .array(
    z.object({
      _id: objectId.optional(),
      options: z.array(nonEmpty(60)).min(1).max(MAX_VARIANT_OPTIONS),
      price: money.min(1, 'Enter a price'),
      mrp: money.min(1, 'Enter the MRP'),
      sku: optionalText(64),
      barcode: optionalBarcode,
      stock: z.number().int().min(0).max(1_000_000).default(0),
      available: z.boolean().default(true),
      weightKg: nonNegative(100_000).optional(),
      image: imageInput.optional(),
    }),
  )
  .max(MAX_VARIANTS, `Up to ${MAX_VARIANTS} variants`);

const quotes = z.object({
  enabled: z.boolean(),
  minQty: z.number().int().min(1).max(10_000_000).optional(),
});

const stringList = (max, itemMax) =>
  z
    .array(z.string().trim().min(1).max(itemMax))
    .max(max)
    .transform((list) => [...new Set(list)]);

/** Fields shared by vendor and admin writes. No defaults here so partial updates never overwrite data. */
const fields = {
  type: z.enum(PRODUCT_TYPES),
  name: nonEmpty(200),
  category: objectId,
  sku: optionalText(64),
  barcode: optionalBarcode,
  brand: optionalText(80),
  modelNumber: optionalText(80),
  shortDescription: optionalText(500),
  description: optionalText(20_000),
  images: z.array(imageInput).max(MAX_PRODUCT_IMAGES),
  videos: z.array(videoInput).max(MAX_PRODUCT_VIDEOS, `Up to ${MAX_PRODUCT_VIDEOS} videos`),
  // How photos and videos interleave in the gallery (see products/gallery.js).
  mediaOrder: z.array(z.enum(MEDIA_KINDS)).max(MAX_PRODUCT_IMAGES + MAX_PRODUCT_VIDEOS),
  pricing,
  // null or empty: use the category's code.
  hsnCode,
  inventory,
  variantOptions,
  variants,
  bulkPricing,
  quotes,
  specifications: z.array(z.object({ label: nonEmpty(80), value: nonEmpty(300) })).max(50),
  condition: z.enum(PRODUCT_CONDITIONS),
  warranty: z.object({ months: z.number().int().min(0).max(240).optional(), details: optionalText(500) }),
  shipping: z.object({
    weightKg: nonNegative(100_000).optional(),
    lengthCm: nonNegative(10_000).optional(),
    widthCm: nonNegative(10_000).optional(),
    heightCm: nonNegative(10_000).optional(),
    dispatchDays: z.number().int().min(0).max(60).optional(),
  }),
  compatibleWith: z.array(objectId).max(100),
  compatibleModels: stringList(100, 80),
  // Lowercased before de-duplicating, so "Drill" and "drill" are one tag.
  tags: stringList(20, 40).transform((t) => [...new Set(t.map((s) => s.toLowerCase()))]),
  searchKeywords: stringList(30, 80).transform((t) => [...new Set(t.map((s) => s.toLowerCase()))]),
};

const required = ['type', 'name', 'category', 'pricing', 'inventory'];
const createShape = Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, required.includes(k) ? v : v.optional()]));

const adminFields = {
  status: z.enum(PRODUCT_STATUSES).optional(),
  isFeatured: z.boolean().optional(),
  seo: z.object({ title: optionalText(160), description: optionalText(320) }).optional(),
};

export const vendorCreateProduct = {
  // cloneOf: the product this one was copied from, so its photos and videos can be reused.
  body: z.object({ ...createShape, publish: z.boolean().default(false), cloneOf: objectId.optional() }),
};

/**
 * Stock values the edit form loaded. A submitted quantity equal to its base wasn't touched by the
 * seller, so the live count (which orders may have moved since) is kept instead of the stale one.
 */
const stockBase = z
  .object({
    stock: z.number().int().min(0).optional(),
    variants: z
      .array(z.object({ _id: objectId, stock: z.number().int().min(0) }))
      .max(MAX_VARIANTS)
      .optional(),
  })
  .optional();

export const vendorUpdateProduct = {
  params: idParams,
  body: z.object({ ...fields, publish: z.boolean(), stockBase }).partial(),
};

export const vendorVisibility = {
  params: idParams,
  body: z.object({ visible: z.boolean() }),
};

export const vendorStockUpdate = {
  params: idParams,
  body: z
    .object({
      stock: z.number().int().min(0).max(1_000_000).optional(),
      available: z.boolean().optional(),
      price: money.min(1).optional(),
      mrp: money.min(1).optional(),
    })
    .refine((v) => Object.values(v).some((x) => x !== undefined), 'Nothing to update'),
};

/**
 * One row of the bulk-edit sheet: only the cells that changed. Money in paise.
 * gstRate / hsnCode null = follow the category again.
 */
const bulkRow = z
  .object({
    _id: objectId,
    name: nonEmpty(200).optional(),
    sku: z.string().trim().max(64).optional(),
    brand: z.string().trim().max(80).optional(),
    shortDescription: z.string().trim().max(500).optional(),
    tags: fields.tags.optional(),
    searchKeywords: fields.searchKeywords.optional(),
    mrp: money.min(1, 'Enter the MRP').optional(),
    price: money.min(1, 'Enter the selling price').optional(),
    gstRate: gstRate.nullable().optional(),
    hsnCode: hsnCode.optional(),
    stock: z.number().int().min(0).max(1_000_000).optional(),
    moq: z.number().int().min(1).max(100_000).optional(),
    available: z.boolean().optional(),
  })
  .refine((r) => Object.keys(r).some((k) => k !== '_id' && r[k] !== undefined), 'Nothing to update');

export const bulkUpdateProducts = {
  body: z.object({
    items: z
      .array(bulkRow)
      .min(1)
      .max(100, 'Up to 100 products at a time')
      .refine((rows) => new Set(rows.map((r) => r._id)).size === rows.length, 'Each product can appear only once'),
  }),
};

export const adminUpdateProduct = {
  params: idParams,
  body: z.object({ ...fields, ...adminFields, stockBase }).partial(),
};

export const reviewProduct = {
  params: idParams,
  body: z
    .object({ action: z.enum(['approve', 'reject']), note: optionalText(1000) })
    .refine((v) => v.action === 'approve' || v.note, { path: ['note'], message: 'Tell the vendor what to fix' }),
};

const listBase = {
  ...paginationQuery,
  q: z.string().trim().max(100).optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  category: objectId.optional(),
};

export const vendorListProducts = {
  query: z.object({ ...listBase, status: z.enum(PRODUCT_STATUSES).optional() }),
};

export const adminListProducts = {
  query: z.object({ ...listBase, status: z.enum(PRODUCT_STATUSES).optional(), vendor: objectId.optional(), featured: queryBool }),
};

const csvList = z
  .string()
  .max(500)
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .optional();

export const PUBLIC_SORTS = ['relevance', 'newest', 'price_asc', 'price_desc', 'discount'];

export const publicListProducts = {
  query: z.object({
    // Bounded: each page past the first makes the database sort and skip everything before it.
    page: paginationQuery.page.pipe(z.number().max(500)),
    limit: z.coerce.number().int().min(1).max(60).default(24),
    q: z.string().trim().max(100).optional(),
    category: z.string().trim().max(120).optional(),
    vendor: z.string().trim().max(120).optional(),
    type: z.enum(PRODUCT_TYPES).optional(),
    brand: csvList,
    condition: z.enum(PRODUCT_CONDITIONS).optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    inStock: queryBool,
    featured: queryBool,
    bulk: queryBool,
    sort: z.enum(PUBLIC_SORTS).optional(),
    ids: z
      .string()
      .max(2000)
      .transform((v) => v.split(',').filter(Boolean))
      .pipe(z.array(objectId).max(60))
      .optional(),
  }),
};

export const COMPARE_MAX = 4;

export const compareProducts = {
  query: z.object({
    ids: z
      .string()
      .max(200)
      .transform((v) => [...new Set(v.split(',').filter(Boolean))])
      .pipe(z.array(objectId).min(1).max(COMPARE_MAX)),
  }),
};

export const suggestQuery = { query: z.object({ q: z.string().trim().min(2).max(100) }) };
export const productSlugParams = { params: z.object({ slug: z.string().trim().min(1).max(200) }) };
