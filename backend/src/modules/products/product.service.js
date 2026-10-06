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
  'pricing',
  'hsnCode',
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

/** Converts validated input into model fields, resolving refs the client isn't trusted with. */
async function buildChanges(input, actor, selfId) {
  const changes = {};
  for (const key of SIMPLE_FIELDS) if (input[key] !== undefined) changes[key] = input[key];
  if (input.category !== undefined) Object.assign(changes, await categoryService.assertUsableForProduct(input.category, actor));
  if (input.images !== undefined) changes.images = await mediaService.resolve(input.images, actor);
  if (input.compatibleWith !== undefined) changes.compatibleWith = await assertCompatibleTargets(input.compatibleWith, selfId);
  if (input.variants !== undefined) {
    // Variant ids are kept from the input so cart lines pointing at them stay valid.
    const resolved = await mediaService.resolve(
      input.variants.filter((v) => v.image).map((v) => v.image),
      actor,
    );
    let next = 0;
    changes.variants = input.variants.map(({ image, ...v }) => (image ? { ...v, image: resolved[next++] } : v));
  }
  return changes;
}

/** Cross-field rules, derived fields and auto SKUs; runs before every product save. */
function prepareForSave(product) {
  assertValidVariants(product);
  syncInventory(product);
  assertValidBulkPricing(product);
  if (['pending', 'active'].includes(product.status) && !product.hsnCode) {
    throw ApiError.unprocessable('Add the HSN/SAC code before publishing', {
      code: 'HSN_REQUIRED',
      details: [{ path: 'hsnCode', message: 'HSN/SAC code is required' }],
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

function commonFilter({ q, type, category, status }) {
  const filter = {};
  if (q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    filter.$or = [{ name: rx }, { sku: rx }, { brand: rx }, { modelNumber: rx }];
  }
  if (type) filter.type = type;
  if (category) filter.categoryPath = category;
  if (status) filter.status = status;
  return filter;
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
    const changes = await buildChanges(input, actor);
    const product = new Product({
      ...changes,
      vendor: vendor._id,
      vendorApproved: vendor.status === 'approved',
      slug: await uniqueSlug(Product, input.name),
      status: 'draft',
    });

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
    const changes = await buildChanges(input, actor, product._id);
    const before = product.toObject();
    const reviewedChange = REVIEWED_FIELDS.some((f) => f in changes && toComparable(before[f]) !== toComparable(changes[f]));
    product.set(changes);

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
  async compatibilityCandidates(q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const rows = await Product.find({
      type: { $in: ['machinery', 'tool'] },
      status: { $in: ['active', 'pending', 'inactive'] },
      $or: [{ name: rx }, { modelNumber: rx }, { brand: rx }],
    })
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

    product.set(await buildChanges(input, { kind: 'admin', id: admin.id }, product._id));
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
      .populate('vendor', 'store address.city address.state createdAt isPlatform')
      .populate({ path: 'compatibleWith', match: VISIBLE, select: CARD_FIELDS })
      .lean();
    if (!product) throw ApiError.notFound('Product not found');

    const [breadcrumbs, spareParts, related, fromSeller] = await Promise.all([
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
    ]);

    return {
      product: {
        ...serializePublicProduct(product),
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

  async suggest(q) {
    const rx = new RegExp(escapeRegex(q), 'i');
    const [products, categories] = await Promise.all([
      Product.find({ ...VISIBLE, $or: [{ name: rx }, { brand: rx }, { modelNumber: rx }, { compatibleModels: rx }] })
        .sort({ isFeatured: -1, publishedAt: -1 })
        .limit(6)
        .select('name slug images pricing')
        .lean(),
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
