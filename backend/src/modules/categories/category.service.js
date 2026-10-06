import { cached } from '#core/cache/cached.js';
import { ApiError } from '#core/errors/ApiError.js';
import { escapeRegex, uniqueSlug } from '#core/utils/strings.js';
import { mediaService } from '#modules/media/media.service.js';
import { Product } from '#modules/products/product.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { Category, MAX_CATEGORY_LEVEL } from './category.model.js';

const PUBLIC_FIELDS = 'name slug description image parent level sortOrder isFeatured';

/** Nested tree of active categories whose whole ancestry is active. Cached cluster-wide. */
const publicTree = cached(
  'category-tree',
  async () => {
    const rows = await Category.find({ status: 'active' }).sort({ sortOrder: 1, name: 1 }).select(PUBLIC_FIELDS).lean();
    const byId = new Map(rows.map((c) => [String(c._id), { ...c, children: [] }]));
    const roots = [];
    for (const node of byId.values()) {
      if (!node.parent) roots.push(node);
      else byId.get(String(node.parent))?.children.push(node);
      // A child whose parent is inactive has no entry to attach to, so it is dropped with it.
    }
    return roots;
  },
  5 * 60_000,
);

async function placementFor(parentId, actor) {
  if (!parentId) return { parent: null, ancestors: [], level: 0 };

  const parent = await Category.findById(parentId).lean();
  if (!parent) throw ApiError.unprocessable('Parent category not found', { code: 'PARENT_NOT_FOUND' });

  if (actor.kind === 'vendor') {
    const usable = parent.status === 'active' || String(parent.owner) === String(actor.id);
    if (!usable) throw ApiError.unprocessable('You cannot add a sub-category under this category', { code: 'PARENT_NOT_ALLOWED' });
  }
  if (parent.level >= MAX_CATEGORY_LEVEL) {
    throw ApiError.unprocessable(`Categories can be at most ${MAX_CATEGORY_LEVEL + 1} levels deep`, { code: 'MAX_DEPTH' });
  }
  return { parent: parent._id, ancestors: [...parent.ancestors, parent._id], level: parent.level + 1 };
}

async function assertUniqueName(name, parent, excludeId) {
  const clash = await Category.exists({
    parent: parent ?? null,
    name: new RegExp(`^${escapeRegex(name)}$`, 'i'),
    status: { $ne: 'rejected' },
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
  });
  if (clash) throw ApiError.conflict('A category with this name already exists at this level', { code: 'DUPLICATE_CATEGORY' });
}

/** Re-parents a category: rewrites descendants' ancestry and every affected product's categoryPath. */
async function applyMove(category, placement) {
  const descendants = await Category.find({ ancestors: category._id }).select('ancestors level').lean();
  const deepest = descendants.reduce((max, d) => Math.max(max, d.level), category.level);
  if (placement.level + (deepest - category.level) > MAX_CATEGORY_LEVEL) {
    throw ApiError.unprocessable('Moving here would make the tree deeper than allowed', { code: 'MAX_DEPTH' });
  }

  category.parent = placement.parent;
  category.ancestors = placement.ancestors;
  category.level = placement.level;

  const newPaths = [{ id: category._id, path: [...placement.ancestors, category._id] }];
  const ops = descendants.map((d) => {
    const tail = d.ancestors.slice(d.ancestors.findIndex((a) => String(a) === String(category._id)));
    const ancestors = [...placement.ancestors, ...tail];
    newPaths.push({ id: d._id, path: [...ancestors, d._id] });
    return { updateOne: { filter: { _id: d._id }, update: { ancestors, level: ancestors.length } } };
  });
  if (ops.length) await Category.bulkWrite(ops);
  await Product.bulkWrite(newPaths.map(({ id, path }) => ({ updateMany: { filter: { category: id }, update: { categoryPath: path } } })));
}

export function serializeCategory(c) {
  return {
    _id: c._id,
    name: c.name,
    slug: c.slug,
    description: c.description ?? null,
    image: c.image ?? null,
    parent: c.parent ?? null,
    ancestors: c.ancestors ?? [],
    level: c.level,
    status: c.status,
    owner: c.owner ?? null,
    review: c.review?.note || c.review?.reviewedAt ? c.review : null,
    sortOrder: c.sortOrder,
    isFeatured: c.isFeatured,
    seo: c.seo ?? null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export const categoryService = {
  tree: () => publicTree.get(),

  async create(input, actor) {
    const placement = await placementFor(input.parent, actor);
    await assertUniqueName(input.name, placement.parent);

    let status = 'active';
    if (actor.kind === 'vendor') {
      // Admins run the platform store, so its categories need no approval.
      const { autoApproveCategories } = await settingsService.get('moderation');
      status = autoApproveCategories || (await Vendor.exists({ _id: actor.id, isPlatform: true })) ? 'active' : 'pending';
    } else if (input.status) {
      status = input.status;
    }

    const category = await Category.create({
      name: input.name,
      slug: await uniqueSlug(Category, input.name),
      description: input.description,
      image: input.image ? await mediaService.resolveOne(input.image, actor) : undefined,
      ...placement,
      owner: actor.kind === 'vendor' ? actor.id : null,
      status,
      ...(actor.kind === 'admin' ? { sortOrder: input.sortOrder ?? 0, isFeatured: input.isFeatured ?? false, seo: input.seo } : {}),
      createdBy: actor,
    });

    await publicTree.invalidate();
    return serializeCategory(category.toObject());
  },

  async update(id, input, actor) {
    const category = await Category.findById(id);
    if (!category) throw ApiError.notFound('Category not found');

    if (actor.kind === 'vendor') {
      if (String(category.owner) !== String(actor.id)) throw ApiError.forbidden('You can only edit categories you created');
      if (!['pending', 'rejected'].includes(category.status)) {
        throw ApiError.forbidden('Approved categories are managed by the marketplace team', { code: 'CATEGORY_LOCKED' });
      }
    }

    const parentChanged = input.parent !== undefined && String(input.parent ?? '') !== String(category.parent ?? '');
    if (parentChanged && input.parent) {
      const intoOwnSubtree =
        String(input.parent) === String(category._id) || (await Category.exists({ _id: input.parent, ancestors: category._id }));
      if (intoOwnSubtree) throw ApiError.unprocessable('A category cannot be moved inside itself', { code: 'CATEGORY_CYCLE' });
    }

    if (input.name !== undefined || parentChanged) {
      await assertUniqueName(input.name ?? category.name, parentChanged ? input.parent : category.parent, category._id);
    }
    if (parentChanged) await applyMove(category, await placementFor(input.parent, actor));

    if (input.name !== undefined) category.name = input.name;
    if (input.description !== undefined) category.description = input.description;
    if (input.image !== undefined) category.image = input.image ? await mediaService.resolveOne(input.image, actor) : undefined;

    if (actor.kind === 'admin') {
      for (const key of ['sortOrder', 'isFeatured', 'seo', 'status']) {
        if (input[key] !== undefined) category[key] = input[key];
      }
    } else if (category.status === 'rejected') {
      // A vendor editing a rejected category is resubmitting it.
      category.status = 'pending';
    }

    await category.save();
    await publicTree.invalidate();
    return serializeCategory(category.toObject());
  },

  async remove(id, actor) {
    const category = await Category.findById(id).lean();
    if (!category) throw ApiError.notFound('Category not found');

    if (actor.kind === 'vendor') {
      if (String(category.owner) !== String(actor.id)) throw ApiError.forbidden('You can only delete categories you created');
      if (category.status === 'active') throw ApiError.forbidden('Approved categories are managed by the marketplace team');
    }

    const [children, products] = await Promise.all([
      Category.exists({ parent: category._id }),
      Product.exists({ categoryPath: category._id, status: { $ne: 'archived' } }),
    ]);
    if (children) throw ApiError.conflict('Delete or move its sub-categories first', { code: 'CATEGORY_HAS_CHILDREN' });
    if (products) throw ApiError.conflict('Move its products to another category first', { code: 'CATEGORY_HAS_PRODUCTS' });

    await Category.deleteOne({ _id: category._id });
    await publicTree.invalidate();
  },

  async review(id, { action, note }, admin) {
    const category = await Category.findById(id);
    if (!category) throw ApiError.notFound('Category not found');

    if (action === 'approve' && category.parent) {
      const parent = await Category.findById(category.parent).select('status').lean();
      if (parent?.status !== 'active') throw ApiError.conflict('Approve the parent category first', { code: 'PARENT_NOT_ACTIVE' });
    }

    category.status = action === 'approve' ? 'active' : 'rejected';
    category.review = { note: action === 'reject' ? note : undefined, reviewedAt: new Date(), reviewedBy: admin.id };
    await category.save();
    await publicTree.invalidate();
    return serializeCategory(category.toObject());
  },

  async listForAdmin({ page, limit, q, status, source, parent }) {
    const filter = {};
    if (q) filter.name = new RegExp(escapeRegex(q), 'i');
    if (status) filter.status = status;
    if (source === 'platform') filter.owner = null;
    if (source === 'vendor') filter.owner = { $ne: null };
    if (parent) filter.parent = parent === 'root' ? null : parent;

    const [rows, total] = await Promise.all([
      Category.find(filter)
        .sort({ level: 1, sortOrder: 1, name: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('owner', 'store.name phone')
        .populate('parent', 'name slug')
        .lean(),
      Category.countDocuments(filter),
    ]);

    const counts = await productCounts(rows.map((r) => r._id));
    return {
      items: rows.map((r) => ({ ...serializeCategory(r), productCount: counts.get(String(r._id)) ?? 0 })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  },

  /** Everything a vendor can file products under: all active categories plus their own proposals. */
  async listForVendor(vendorId) {
    const rows = await Category.find({ $or: [{ status: 'active' }, { owner: vendorId }] })
      .sort({ level: 1, sortOrder: 1, name: 1 })
      .lean();
    return rows.map((r) => ({ ...serializeCategory(r), mine: String(r.owner) === String(vendorId) }));
  },

  async publicBySlug(slug) {
    const category = await Category.findOne({ slug, status: 'active' }).select(`${PUBLIC_FIELDS} ancestors seo`).lean();
    if (!category) throw ApiError.notFound('Category not found');

    const [ancestors, children] = await Promise.all([
      Category.find({ _id: { $in: category.ancestors } })
        .select('name slug level status')
        .lean(),
      Category.find({ parent: category._id, status: 'active' }).sort({ sortOrder: 1, name: 1 }).select(PUBLIC_FIELDS).lean(),
    ]);
    if (ancestors.some((a) => a.status !== 'active')) throw ApiError.notFound('Category not found');

    return {
      ...category,
      breadcrumbs: ancestors.sort((a, b) => a.level - b.level).map(({ _id, name, slug: s }) => ({ _id, name, slug: s })),
      children,
    };
  },

  /** Resolves a category for product filing, enforcing what the actor may use. */
  async assertUsableForProduct(categoryId, actor) {
    const category = await Category.findById(categoryId).select('ancestors status owner').lean();
    if (!category) throw ApiError.unprocessable('Category not found', { code: 'CATEGORY_NOT_FOUND' });
    if (actor.kind === 'vendor') {
      const usable = category.status === 'active' || (String(category.owner) === String(actor.id) && category.status !== 'rejected');
      if (!usable) throw ApiError.unprocessable('You cannot list products in this category', { code: 'CATEGORY_NOT_ALLOWED' });
    }
    return { category: category._id, categoryPath: [...category.ancestors, category._id] };
  },
};

async function productCounts(categoryIds) {
  if (!categoryIds.length) return new Map();
  const rows = await Product.aggregate([
    { $match: { categoryPath: { $in: categoryIds }, status: { $ne: 'archived' } } },
    { $unwind: '$categoryPath' },
    { $match: { categoryPath: { $in: categoryIds } } },
    { $group: { _id: '$categoryPath', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}
