import mongoose from 'mongoose';
import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex, uniqueSlug } from '#core/utils/strings.js';
import { Category } from '#modules/categories/category.model.js';
import { categoryService } from '#modules/categories/category.service.js';
import { mediaService } from '#modules/media/media.service.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { serializePublicVendor } from '#modules/vendors/vendor.serializer.js';
import { settingsService } from '#services/settings/settings.service.js';
import { Product } from './product.model.js';
import { recentBuyers } from './recentBuyers.js';
import { mediaOrderOf } from './gallery.js';
import { assertValidVariants, hasVariants, isTracked, syncInventory } from './inventory.js';
import { assertValidBulkPricing } from './pricing.js';
import { CARD_FIELDS, serializeProduct, serializeProductCard, serializePublicProduct } from './product.serializer.js';

/** What makes a product visible on the storefront. */
export const VISIBLE = Object.freeze({ status: 'active', vendorApproved: true });

const SIMPLE_FIELDS = [
  'type',
  'name',
  'sku',
  'barcode',
  'brand',
  'modelNumber',
  'shortDescription',
  'description',
  'mediaOrder',
  'pricing',
  'inventory',
  'variantOptions',
  'bulkPricing',
  'quotes',
  'specifications',
  'condition',
  'warranty',
  'shipping',
  'compatibleModels',
  'tags',
  'searchKeywords',
  'seo',
];

/** Editing any of these on a live product sends it back for review (when moderation is on). */
const REVIEWED_FIELDS = [
  'type',
  'name',
  'category',
  'brand',
  'modelNumber',
  'shortDescription',
  'description',
  'images',
  'videos',
  'specifications',
  'condition',
  'compatibleWith',
  'compatibleModels',
];

const toComparable = (v) => JSON.stringify(v ?? null, (_k, val) => (val instanceof mongoose.Types.ObjectId ? String(val) : val));

async function assertCompatibleTargets(ids, selfId) {
  if (!ids?.length) return [];
  const unique = [...new Set(ids.map(String))].filter((id) => id !== String(selfId));
  const found = await Product.countDocuments({ _id: { $in: unique }, type: { $in: ['machinery', 'tool'] }, status: { $ne: 'archived' } });
  if (found !== unique.length) {
    throw ApiError.unprocessable('Compatible items must be existing tools or machinery', { code: 'INVALID_COMPATIBILITY' });
  }
  return unique;
}

/**
 * Converts validated input into model fields, resolving refs the client isn't trusted with.
 * `allowMedia`: media ids usable although the actor didn't upload them (the source of a clone).
 */
async function buildChanges(input, actor, selfId, { allowMedia } = {}) {
  const changes = {};
  for (const key of SIMPLE_FIELDS) if (input[key] !== undefined) changes[key] = input[key];
  // No rate on the product: it follows the category's (see applyTax).
  if (changes.pricing?.gstRate == null && changes.pricing) {
    const { gstRate: _inherit, ...pricing } = changes.pricing;
    changes.pricing = pricing;
  }
  if (input.category !== undefined) Object.assign(changes, await categoryService.assertUsableForProduct(input.category, actor));
  if (input.images !== undefined) changes.images = await mediaService.resolve(input.images, actor, { allow: allowMedia });
  if (input.videos !== undefined) changes.videos = await mediaService.resolveVideos(input.videos, actor, { allow: allowMedia });
  if (input.compatibleWith !== undefined) changes.compatibleWith = await assertCompatibleTargets(input.compatibleWith, selfId);
  if (input.variants !== undefined) {
    // Variant ids are kept from the input so cart lines pointing at them stay valid.
    const resolved = await mediaService.resolve(
      input.variants.filter((v) => v.image).map((v) => v.image),
      actor,
      { allow: allowMedia },
    );
    let next = 0;
    changes.variants = input.variants.map(({ image, ...v }) => (image ? { ...v, image: resolved[next++] } : v));
  }
  return changes;
}

/**
 * Edit forms send back every quantity they loaded. Where a quantity still equals what the form loaded,
 * the seller didn't change it: keep the live count, so sales made while the form was open aren't undone.
 */
function keepUntouchedStock(changes, product, base) {
  if (!base) return;
  if (changes.inventory && base.stock !== undefined && changes.inventory.stock === base.stock) {
    changes.inventory = { ...changes.inventory, stock: product.inventory?.stock ?? 0 };
  }
  if (changes.variants && base.variants?.length) {
    const loaded = new Map(base.variants.map((v) => [String(v._id), v.stock]));
    const live = new Map((product.variants ?? []).map((v) => [String(v._id), v.stock]));
    changes.variants = changes.variants.map((v) => {
      const id = v._id && String(v._id);
      return id && live.has(id) && loaded.get(id) === v.stock ? { ...v, stock: live.get(id) } : v;
    });
  }
}

/**
 * HSN code and GST rate: a value sent for the product is its own; left empty it follows the category
 * (the nearest one up the tree that sets it), and keeps following it when the category's value changes.
 * Runs after the input is applied, so a new category is picked up too.
 */
async function applyTax(product, input, { creating = false } = {}) {
  if (input.hsnCode !== undefined || creating) {
    product.hsnCode = input.hsnCode ?? undefined;
    product.set('taxInherit.hsn', input.hsnCode == null);
  }
  if (input.pricing !== undefined) product.set('taxInherit.gst', input.pricing.gstRate == null);

  const inherit = product.taxInherit ?? {};
  if (!inherit.hsn && !inherit.gst) return;
  const tax = await categoryService.effectiveTax(product.category);
  if (inherit.hsn) product.hsnCode = tax.hsnCode ?? undefined;
  if (inherit.gst) product.set('pricing.gstRate', tax.gstRate ?? undefined);
}

/** Cross-field rules, derived fields and auto SKUs; runs before every product save. */
function prepareForSave(product) {
  product.mediaOrder = mediaOrderOf(product);
  assertValidVariants(product);
  syncInventory(product);
  assertValidBulkPricing(product);
  if (['pending', 'active'].includes(product.status) && !product.hsnCode) {
    throw ApiError.unprocessable('Add the HSN/SAC code (on the product or its category) before publishing', {
      code: 'HSN_REQUIRED',
      details: [{ path: 'hsnCode', message: 'HSN/SAC code is required' }],
    });
  }
  if (['pending', 'active'].includes(product.status) && product.pricing?.gstRate == null) {
    throw ApiError.unprocessable('Choose the GST rate (on the product or its category) before publishing', {
      code: 'GST_REQUIRED',
      details: [{ path: 'pricing.gstRate', message: 'GST rate is required' }],
    });
  }
}

function assertSkuFree(err) {
  if (err?.code === 11000 && err.keyPattern?.sku) {
    throw ApiError.conflict('You already have a product with this SKU', {
      code: 'DUPLICATE_SKU',
      details: [{ path: 'sku', message: 'Already used' }],
    });
  }
  throw err;
}

function markActive(product, now = new Date()) {
  product.status = 'active';
  if (!product.publishedAt) product.publishedAt = now;
  if (!product.get('moderation.approvedAt')) product.set('moderation.approvedAt', now);
  product.set('moderation.note', undefined);
}

function sortStage(sort, hasQuery) {
  switch (sort) {
    case 'price_asc':
      return { 'pricing.price': 1, _id: 1 };
    case 'price_desc':
      return { 'pricing.price': -1, _id: 1 };
    case 'discount':
      return { discount: -1, publishedAt: -1 };
    case 'newest':
      return { publishedAt: -1, _id: -1 };
    case 'relevance':
    default:
      return hasQuery ? { score: { $meta: 'textScore' }, publishedAt: -1 } : { isFeatured: -1, publishedAt: -1, _id: -1 };
  }
}

const listResult = (rows, total, page, limit) => ({
  items: rows.map(serializeProduct),
  meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
});

/** Stock filters for panel lists: in stock, out of stock (or switched off), or at/below the low-stock alert. */
const STOCK_FILTERS = {
  in: { 'inventory.available': { $ne: false }, $or: [{ 'inventory.trackQuantity': false }, { 'inventory.stock': { $gt: 0 } }] },
  out: { $or: [{ 'inventory.available': false }, { 'inventory.trackQuantity': { $ne: false }, 'inventory.stock': { $lte: 0 } }] },
  low: {
    'inventory.trackQuantity': { $ne: false },
    'inventory.stock': { $gt: 0 },
    $expr: { $lte: ['$inventory.stock', { $ifNull: ['$inventory.lowStockThreshold', 5] }] },
  },
};

function commonFilter({ q, type, category, status, stock }) {
  const filter = {};
  const and = [];
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    and.push({ $or: [{ name: rx }, { sku: rx }, { brand: rx }, { modelNumber: rx }] });
  }
  if (stock) and.push(STOCK_FILTERS[stock]);
  if (and.length) filter.$and = and;
  if (type) filter.type = type;
  if (category) filter.categoryPath = category;
  if (status) filter.status = status;
  return filter;
}

/** Ids of every photo and video file on a product (gallery and variant photos). */
function mediaIdsOf(product) {
  const ids = [
    ...(product.images ?? []).map((i) => i.media),
    ...(product.videos ?? []).map((v) => v.media),
    ...(product.variants ?? []).map((v) => v.image?.media),
  ];
  return new Set(ids.filter(Boolean).map(String));
}

/**
 * Photos and videos of the product a new listing is cloned from, which the clone may reuse.
 * Sellers clone their own products; the platform store (run by admins) can clone any listing.
 */
async function cloneMedia(vendor, sourceId) {
  if (!sourceId) return undefined;
  const filter = { _id: sourceId, ...(vendor.isPlatform ? {} : { vendor: vendor._id }) };
  const source = await Product.findOne(filter).select('images videos variants.image').lean();
  if (!source) throw ApiError.unprocessable('The product you are copying was not found', { code: 'CLONE_SOURCE_NOT_FOUND' });
  return mediaIdsOf(source);
}

/** Bulk-edit sheet row → the partial input vendorUpdate/adminUpdate take, merged with the product's current values. */
function bulkRowInput(product, row) {
  const input = {};
  // An emptied cell clears the value (null also keeps an empty SKU out of the unique SKU index).
  for (const key of ['name', 'sku', 'brand', 'shortDescription']) if (row[key] !== undefined) input[key] = row[key] === '' ? null : row[key];
  for (const key of ['tags', 'searchKeywords']) if (row[key] !== undefined) input[key] = row[key];
  if (row.hsnCode !== undefined) input.hsnCode = row.hsnCode;

  const touchesPrice = row.mrp !== undefined || row.price !== undefined;
  if ((touchesPrice || row.stock !== undefined) && hasVariants(product)) {
    throw ApiError.unprocessable('This product has variants. Open the product to change variant prices and stock.', {
      code: 'HAS_VARIANTS',
      details: [{ path: row.stock !== undefined ? 'stock' : 'price', message: 'Set per variant' }],
    });
  }
  if (touchesPrice || row.gstRate !== undefined) {
    const mrp = row.mrp ?? product.pricing.mrp;
    const price = row.price ?? product.pricing.price;
    if (price > mrp) {
      throw ApiError.unprocessable('Selling price cannot be more than MRP', {
        details: [{ path: 'price', message: 'More than MRP' }],
      });
    }
    // Left alone, the rate keeps following the category if it did.
    const gst = row.gstRate !== undefined ? row.gstRate : product.taxInherit?.gst ? null : (product.pricing.gstRate ?? null);
    input.pricing = { mrp, price, gstRate: gst };
  }

  if (row.stock !== undefined || row.moq !== undefined || row.available !== undefined) {
    if (row.stock !== undefined && !isTracked(product)) {
      throw ApiError.unprocessable('Quantity is not tracked for this product', {
        code: 'NOT_TRACKED',
        details: [{ path: 'stock', message: 'Not tracked' }],
      });
    }
    const inventory = { ...product.inventory };
    if (row.stock !== undefined) inventory.stock = row.stock;
    if (row.moq !== undefined) inventory.moq = row.moq;
    if (row.available !== undefined) inventory.available = row.available;
    if (inventory.maxOrderQty && inventory.maxOrderQty < inventory.moq) {
      throw ApiError.unprocessable('Minimum order is more than the maximum per order', {
        details: [{ path: 'moq', message: `Max per order is ${inventory.maxOrderQty}` }],
      });
    }
    input.inventory = inventory;
  }
  return input;
}

/**
 * Applies sheet rows one by one; a row that fails doesn't stop the others.
 * @returns {{ updated: object[], failed: { _id: string, message: string, code?: string, details?: any }[] }}
 */
async function applyBulk(rows, filter, update) {
  const products = await Product.find({ ...filter, _id: { $in: rows.map((r) => r._id) }, status: { $ne: 'archived' } }).lean();
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const updated = [];
  const failed = [];
  for (const row of rows) {
    const product = byId.get(String(row._id));
    if (!product) {
      failed.push({ _id: row._id, message: 'Product not found', code: 'NOT_FOUND' });
      continue;
    }
    try {
      updated.push(await update(product, bulkRowInput(product, row)));
    } catch (err) {
      if (!(err instanceof ApiError) && err?.name !== 'ValidationError') throw err;
      const details = err.details ?? Object.values(err.errors ?? {}).map((e) => ({ path: e.path, message: e.message }));
      failed.push({ _id: row._id, message: err.message, code: err.code, details });
    }
  }
  return { updated, failed };
}

/** The platform's own store publishes straight away; other sellers follow the moderation setting. */
async function autoApproves(vendor) {
  if (vendor.isPlatform) return true;
  return (await settingsService.get('moderation')).autoApproveProducts;
}

export const productService = {
  /* ─────────────────────────── Vendor ─────────────────────────── */

  async vendorCreate(vendor, input) {
    const actor = { kind: 'vendor', id: vendor._id };
    const changes = await buildChanges(input, actor, undefined, { allowMedia: await cloneMedia(vendor, input.cloneOf) });
    const product = new Product({
      ...changes,
      vendor: vendor._id,
      vendorApproved: vendor.status === 'approved',
      slug: await uniqueSlug(Product, input.name),
      status: 'draft',
    });
    await applyTax(product, input, { creating: true });

    if (input.publish) {
      const autoApproveProducts = await autoApproves(vendor);
      if (autoApproveProducts) markActive(product);
      else product.status = 'pending';
    }

    prepareForSave(product);
    await product.save().catch(assertSkuFree);
    return serializeProduct(product.toObject());
  },

  async vendorUpdate(vendor, id, input) {
    const product = await Product.findOne({ _id: id, vendor: vendor._id, status: { $ne: 'archived' } });
    if (!product) throw ApiError.notFound('Product not found');

    const actor = { kind: 'vendor', id: vendor._id };
    // Media already on the product stays usable even if someone else uploaded it (an admin's edit, the demo seed).
    const changes = await buildChanges(input, actor, product._id, { allowMedia: mediaIdsOf(product) });
    keepUntouchedStock(changes, product, input.stockBase);
    const before = product.toObject();
    const reviewedChange = REVIEWED_FIELDS.some((f) => f in changes && toComparable(before[f]) !== toComparable(changes[f]));
    product.set(changes);
    await applyTax(product, input);

    const autoApproveProducts = await autoApproves(vendor);
    if (input.publish && ['draft', 'rejected'].includes(product.status)) {
      if (autoApproveProducts) markActive(product);
      else product.status = 'pending';
    } else if (reviewedChange && ['active', 'inactive'].includes(product.status) && !autoApproveProducts) {
      product.status = 'pending';
    }

    prepareForSave(product);
    await product.save().catch(assertSkuFree);
    return serializeProduct(product.toObject());
  },

  /** Quick inline edit from the product table; price/stock changes never need review. */
  async vendorQuickUpdate(vendor, id, { stock, available, price, mrp }) {
    const product = await Product.findOne({ _id: id, vendor: vendor._id, status: { $ne: 'archived' } });
    if (!product) throw ApiError.notFound('Product not found');
    if (available !== undefined) product.inventory.available = available;
    if ((stock !== undefined || price !== undefined || mrp !== undefined) && hasVariants(product)) {
      throw ApiError.unprocessable('This product has variants. Edit the product to change variant prices and stock.', {
        code: 'HAS_VARIANTS',
      });
    }
    if (stock !== undefined) {
      if (!isTracked(product)) throw ApiError.unprocessable('Quantity is not tracked for this product', { code: 'NOT_TRACKED' });
      product.inventory.stock = stock;
    }
    if (mrp !== undefined) product.pricing.mrp = mrp;
    if (price !== undefined) product.pricing.price = price;
    if (product.pricing.price > product.pricing.mrp) throw ApiError.unprocessable('Selling price cannot be more than MRP');
    try {
      assertValidBulkPricing(product);
    } catch (err) {
      if (err.code !== 'INVALID_BULK_PRICING') throw err;
      throw ApiError.unprocessable('Bulk tier prices must stay below the selling price. Edit the product to update its tiers first.', {
        code: 'INVALID_BULK_PRICING',
      });
    }
    await product.save();
    return serializeProduct(product.toObject());
  },

  /** Bulk-edit sheet: same rules as editing each product (live listings may go back to review). */
  vendorBulkUpdate(vendor, rows) {
    return applyBulk(rows, { vendor: vendor._id }, (product, input) => productService.vendorUpdate(vendor, product._id, input));
  },

  async vendorSetVisibility(vendor, id, visible) {
    const product = await Product.findOne({ _id: id, vendor: vendor._id });
    if (!product) throw ApiError.notFound('Product not found');
    if (!['active', 'inactive'].includes(product.status)) {
      throw ApiError.conflict('Only approved products can be shown or hidden', { code: 'INVALID_STATUS' });
    }
    product.status = visible ? 'active' : 'inactive';
    await product.save();
    return serializeProduct(product.toObject());
  },

  async vendorArchive(vendor, id) {
    const res = await Product.updateOne(
      { _id: id, vendor: vendor._id, status: { $ne: 'archived' } },
      { status: 'archived', isFeatured: false },
    );
    if (!res.matchedCount) throw ApiError.notFound('Product not found');
  },

  async vendorGet(vendor, id) {
    const product = await Product.findOne({ _id: id, vendor: vendor._id, status: { $ne: 'archived' } })
      .populate('compatibleWith', 'name slug type images')
      .lean();
    if (!product) throw ApiError.notFound('Product not found');
    return serializeProduct(product);
  },

  async vendorList(vendor, { page, limit, ...query }) {
    const filter = { ...commonFilter(query), vendor: vendor._id };
    if (!query.status) filter.status = { $ne: 'archived' };
    const [rows, total] = await Promise.all([
      Product.find(filter)
        .sort({ updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('category', 'name slug')
        .lean(),
      Product.countDocuments(filter),
    ]);
    return listResult(rows, total, page, limit);
  },

  /** Lightweight search used by the "compatible with" picker (any vendor's tools/machinery). */
  /** Machines a part can be linked to: anything live, plus the seller's own not-yet-live listings. */
  async compatibilityCandidates(q, vendorId) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const rows = await Product.find({
      type: { $in: ['machinery', 'tool'] },
      $and: [
        { $or: [{ status: 'active' }, { vendor: vendorId, status: { $in: ['pending', 'inactive'] } }] },
        { $or: [{ name: rx }, { modelNumber: rx }, { brand: rx }] },
      ],
    })
      .maxTimeMS(2_000)
      .limit(20)
      .select('name slug type brand modelNumber images')
      .lean();
    return rows.map((r) => ({
      _id: r._id,
      name: r.name,
      slug: r.slug,
      type: r.type,
      brand: r.brand,
      modelNumber: r.modelNumber,
      image: r.images?.[0] ?? null,
    }));
  },

  /* ─────────────────────────── Admin ─────────────────────────── */

  async adminList({ page, limit, vendor, featured, ...query }) {
    const filter = commonFilter(query);
    if (vendor) filter.vendor = vendor;
    if (featured !== undefined) filter.isFeatured = featured;
    const [rows, total] = await Promise.all([
      Product.find(filter)
        .sort({ status: 1, updatedAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('category', 'name slug')
        .populate('vendor', 'store.name store.slug phone status')
        .lean(),
      Product.countDocuments(filter),
    ]);
    return listResult(rows, total, page, limit);
  },

  async adminGet(id) {
    const product = await Product.findById(id)
      .populate('category', 'name slug')
      .populate('vendor', 'store.name store.slug phone status contactName')
      .populate('compatibleWith', 'name slug type images')
      .lean();
    if (!product) throw ApiError.notFound('Product not found');
    return serializeProduct(product);
  },

  async adminUpdate(id, input, admin) {
    const product = await Product.findById(id);
    if (!product) throw ApiError.notFound('Product not found');

    const changes = await buildChanges(input, { kind: 'admin', id: admin.id }, product._id);
    keepUntouchedStock(changes, product, input.stockBase);
    product.set(changes);
    await applyTax(product, input);
    if (input.isFeatured !== undefined) product.isFeatured = input.isFeatured;
    if (input.seo !== undefined) product.seo = input.seo;
    if (input.status !== undefined) {
      if (input.status === 'active') markActive(product);
      else product.status = input.status;
    }

    prepareForSave(product);
    await product.save().catch(assertSkuFree);
    return serializeProduct(product.toObject());
  },

  adminBulkUpdate(rows, admin) {
    return applyBulk(rows, {}, (product, input) => productService.adminUpdate(product._id, input, admin));
  },

  async adminReview(id, { action, note }, admin) {
    const product = await Product.findById(id);
    if (!product) throw ApiError.notFound('Product not found');
    if (product.status === 'archived') throw ApiError.conflict('Archived products cannot be reviewed');

    if (action === 'approve') markActive(product);
    else {
      product.status = 'rejected';
      product.isFeatured = false;
      product.set('moderation.note', note);
    }
    product.set('moderation.reviewedAt', new Date());
    product.set('moderation.reviewedBy', admin.id);
    await product.save();
    return serializeProduct(product.toObject());
  },

  /* ─────────────────────────── Public ─────────────────────────── */

  async publicList({ page, limit, q, category, vendor, type, brand, condition, minPrice, maxPrice, inStock, featured, bulk, sort, ids }) {
    const match = { ...VISIBLE };
    if (q) match.$text = { $search: q };

    if (category) {
      const cat = await Category.findOne({ slug: category, status: 'active' }).select('_id').lean();
      if (!cat) return { items: [], meta: { page, limit, total: 0, totalPages: 1 }, facets: emptyFacets() };
      match.categoryPath = cat._id;
    }
    if (vendor) {
      const v = await Vendor.findOne({ 'store.slug': vendor, status: 'approved' }).select('_id').lean();
      if (!v) return { items: [], meta: { page, limit, total: 0, totalPages: 1 }, facets: emptyFacets() };
      match.vendor = v._id;
    }
    if (ids?.length) match._id = { $in: ids.map((id) => new mongoose.Types.ObjectId(id)) };
    if (type) match.type = type;
    if (condition) match.condition = condition;
    if (inStock) {
      match['inventory.available'] = { $ne: false };
      match.$or = [
        { 'inventory.trackQuantity': false, $or: [{ 'variants.0': { $exists: false } }, { 'variants.available': true }] },
        { 'inventory.trackQuantity': { $ne: false }, 'variants.0': { $exists: false }, 'inventory.stock': { $gt: 0 } },
        { 'inventory.trackQuantity': { $ne: false }, variants: { $elemMatch: { available: { $ne: false }, stock: { $gt: 0 } } } },
      ];
    }
    if (featured) match.isFeatured = true;
    if (bulk) match['bulkPricing.tiers.0'] = { $exists: true };

    // Price range is applied after facets so the price facet shows the full range for the other filters.
    const priceMatch = {};
    if (minPrice !== undefined) priceMatch.$gte = minPrice;
    if (maxPrice !== undefined) priceMatch.$lte = maxPrice;
    const brandFilter = brand?.length ? { brand: { $in: brand } } : {};
    const priceFilter = Object.keys(priceMatch).length ? { 'pricing.price': priceMatch } : {};

    const project = Object.fromEntries(CARD_FIELDS.split(' ').map((f) => [f, 1]));
    const [result] = await Product.aggregate([
      { $match: match },
      {
        $facet: {
          items: [
            { $match: { ...brandFilter, ...priceFilter } },
            ...(sort === 'discount'
              ? [
                  {
                    $addFields: {
                      discount: {
                        $cond: [
                          { $gt: ['$pricing.mrp', 0] },
                          { $divide: [{ $subtract: ['$pricing.mrp', '$pricing.price'] }, '$pricing.mrp'] },
                          0,
                        ],
                      },
                    },
                  },
                ]
              : []),
            { $sort: sortStage(sort, Boolean(q)) },
            { $skip: (page - 1) * limit },
            { $limit: limit },
            { $project: { ...project, images: { $slice: ['$images', 1] }, specifications: { $slice: ['$specifications', 3] } } },
          ],
          total: [{ $match: { ...brandFilter, ...priceFilter } }, { $count: 'n' }],
          brands: [
            { $match: { ...priceFilter, brand: { $nin: [null, ''] } } },
            { $group: { _id: '$brand', count: { $sum: 1 } } },
            { $sort: { count: -1, _id: 1 } },
            { $limit: 30 },
          ],
          types: [{ $match: { ...brandFilter, ...priceFilter } }, { $group: { _id: '$type', count: { $sum: 1 } } }],
          price: [{ $match: brandFilter }, { $group: { _id: null, min: { $min: '$pricing.price' }, max: { $max: '$pricing.price' } } }],
        },
      },
    ]);

    const total = result.total[0]?.n ?? 0;
    return {
      items: result.items.map(serializeProductCard),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
      facets: {
        brands: result.brands.map((b) => ({ value: b._id, count: b.count })),
        types: result.types.map((t) => ({ value: t._id, count: t.count })),
        price: result.price[0] ? { min: result.price[0].min, max: result.price[0].max } : null,
      },
    };
  },

  async publicBySlug(slug) {
    const product = await Product.findOne({ slug, ...VISIBLE })
      .populate('vendor', 'store address.city address.state createdAt isPlatform phone')
      .populate({ path: 'compatibleWith', match: VISIBLE, select: CARD_FIELDS })
      .lean();
    if (!product) throw ApiError.notFound('Product not found');

    const [breadcrumbs, spareParts, related, fromSeller, bought] = await Promise.all([
      Category.find({ _id: { $in: product.categoryPath } })
        .select('name slug level')
        .sort({ level: 1 })
        .lean(),
      product.type === 'part'
        ? []
        : Product.find({ ...VISIBLE, compatibleWith: product._id })
            .sort({ publishedAt: -1 })
            .limit(12)
            .select(CARD_FIELDS)
            .lean(),
      Product.find({ ...VISIBLE, category: product.category, _id: { $ne: product._id } })
        .sort({ isFeatured: -1, publishedAt: -1 })
        .limit(12)
        .select(CARD_FIELDS)
        .lean(),
      Product.find({ ...VISIBLE, vendor: product.vendor._id, _id: { $ne: product._id } })
        .sort({ 'rating.count': -1, publishedAt: -1 })
        .limit(12)
        .select(CARD_FIELDS)
        .lean(),
      recentBuyers(product._id),
    ]);

    return {
      product: {
        ...serializePublicProduct(product),
        recentBuyers: bought,
        vendor: serializePublicVendor(product.vendor),
        compatibleWith: (product.compatibleWith ?? []).map(serializeProductCard),
      },
      breadcrumbs: breadcrumbs.map(({ _id, name, slug: s }) => ({ _id, name, slug: s })),
      spareParts: spareParts.map(serializeProductCard),
      related: related.map(serializeProductCard),
      // The same seller's other listings, minus anything already shown as similar.
      fromSeller: fromSeller.filter((p) => !related.some((r) => String(r._id) === String(p._id))).map(serializeProductCard),
    };
  },

  /** Side-by-side comparison: everything a buyer weighs, in the order asked. Unlisted products are left out. */
  async publicCompare(ids) {
    const products = await Product.find({ _id: { $in: ids }, ...VISIBLE })
      .select('-description -videos -seo -compatibleWith -moderation')
      .populate('vendor', 'store address.city address.state createdAt isPlatform phone')
      .populate('category', 'name slug')
      .lean();
    const byId = new Map(products.map((p) => [String(p._id), p]));
    return ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .map((p) => {
        const full = serializePublicProduct(p);
        return {
          ...serializeProductCard(p),
          shortDescription: full.shortDescription,
          specifications: full.specifications,
          warranty: full.warranty,
          shipping: full.shipping,
          gstRate: full.pricing.gstRate,
          hsnCode: full.hsnCode,
          quotes: full.quotes,
          category: p.category ? { _id: p.category._id, name: p.category.name, slug: p.category.slug } : null,
          vendor: serializePublicVendor(p.vendor),
        };
      });
  },

  async suggest(q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const [products, categories] = await Promise.all([
      Product.find({ ...VISIBLE, $or: [{ name: rx }, { brand: rx }, { modelNumber: rx }, { compatibleModels: rx }] })
        .sort({ isFeatured: -1, publishedAt: -1 })
        .limit(6)
        .select('name slug images pricing')
        // Unanchored regex can't use an index; cap the scan a rare no-match query causes.
        .maxTimeMS(1_500)
        .lean()
        .catch((err) => {
          if (err?.code === 50) return []; // MaxTimeMSExpired: no suggestions beats a failed search box
          throw err;
        }),
      Category.find({ status: 'active', name: rx }).limit(4).select('name slug').lean(),
    ]);
    return {
      products: products.map((p) => ({ _id: p._id, name: p.name, slug: p.slug, image: p.images?.[0] ?? null, price: p.pricing.price })),
      categories,
    };
  },

  /** Keeps the denormalised vendorApproved flag in sync when a vendor's status changes. */
  syncVendorVisibility(vendorId, approved) {
    return Product.updateMany({ vendor: vendorId }, { vendorApproved: approved });
  },
};

function emptyFacets() {
  return { brands: [], types: [], price: null };
}
