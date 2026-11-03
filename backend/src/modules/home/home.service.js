import { catalogGeneration, remember } from '#core/cache/cached.js';
import { Category } from '#modules/categories/category.model.js';
import { categoryService } from '#modules/categories/category.service.js';
import { productService } from '#modules/products/product.service.js';
import { settingsService } from '#services/settings/settings.service.js';

const PER_ROW = 12;
const POOL_TTL_SECONDS = 120;
// Sections fewer than this many unique products are topped up with ones shown higher up the page.
const MIN_ITEMS = 6;

/**
 * Candidate lists per source, shared by every visitor (and server) for a couple of minutes or until the
 * catalogue changes; each visit shuffles its own copy.
 */
async function pool(key, params, size, gen) {
  return remember(
    `home:pool:${gen}:${key}:${size}`,
    POOL_TTL_SECONDS,
    async () => (await productService.publicList({ page: 1, limit: size, ...params })).items,
  );
}

const SOURCES = {
  featured: () => ({ params: { featured: true }, viewAll: '/search?featured=true' }),
  bulk: () => ({ params: { bulk: true }, viewAll: '/search?bulk=true' }),
  newest: () => ({ params: { sort: 'newest' }, viewAll: '/search?sort=newest' }),
  discount: () => ({ params: { sort: 'discount' }, viewAll: '/search?sort=discount' }),
  category: (c) => ({ params: { category: c.slug }, viewAll: `/c/${c.slug}` }),
};

function shuffled(list) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Products not already on the page first; repeats only to stop a section looking empty. */
function pick(candidates, want, used) {
  const fresh = candidates.filter((p) => !used.has(String(p._id)));
  const items = fresh.slice(0, want);
  if (items.length < Math.min(MIN_ITEMS, want)) {
    for (const p of candidates) {
      if (items.length >= Math.min(MIN_ITEMS, want)) break;
      if (!items.includes(p)) items.push(p);
    }
  }
  items.forEach((p) => used.add(String(p._id)));
  return items;
}

/**
 * The home page below the hero, in the admin's order (Settings → Home page): product sections filled
 * and shuffled per visit, with each product shown once where possible.
 */
export async function buildHomePage() {
  const { sections } = await settingsService.get('homepage');
  const live = sections.filter((s) => s.enabled);

  // Expand "one row per top department" into ordinary category sections.
  const tree = live.some((s) => s.kind === 'departmentRails') ? await categoryService.tree() : [];
  const categoryIds = live.filter((s) => s.kind === 'products' && s.source === 'category').map((s) => s.category);
  const categories = new Map(
    (categoryIds.length
      ? await Category.find({ _id: { $in: categoryIds }, status: 'active' })
          .select('name slug')
          .lean()
      : []
    ).map((c) => [String(c._id), c]),
  );

  const expanded = live.flatMap((s) => {
    if (s.kind === 'departmentRails') {
      return tree
        .slice(0, s.count)
        .map((d) => ({ ...s, id: `${s.id}:${d.slug}`, kind: 'products', source: 'category', resolved: d, title: d.name }));
    }
    if (s.kind === 'products' && s.source === 'category') {
      const c = categories.get(String(s.category));
      return c ? [{ ...s, resolved: c, title: s.title || c.name }] : []; // a deleted or hidden category drops its section
    }
    return [s];
  });

  // Fetch every pool at once, then hand out products top to bottom.
  const gen = await catalogGeneration.current();
  const productSections = expanded.filter((s) => s.kind === 'products');
  const fetched = await Promise.all(
    productSections.map((s) => {
      const { params } = SOURCES[s.source](s.resolved);
      const want = s.rows * PER_ROW;
      return pool(`${s.source}:${s.resolved?.slug ?? ''}`, params, Math.min(60, want * 2), gen);
    }),
  );
  const candidates = new Map(productSections.map((s, i) => [s.id, fetched[i]]));
  const brands = expanded.some((s) => s.kind === 'brands') ? await brandFacet(gen) : null;

  const used = new Set();
  const out = [];
  for (const s of expanded) {
    const base = { id: s.id, kind: s.kind, title: s.title, subtitle: s.subtitle };
    if (s.kind === 'products') {
      const list = candidates.get(s.id);
      const items = pick(s.shuffle ? shuffled(list) : list, s.rows * PER_ROW, used);
      if (!items.length) continue;
      out.push({
        ...base,
        rows: Math.min(s.rows, Math.ceil(items.length / 4)),
        viewAll: SOURCES[s.source](s.resolved).viewAll,
        products: items,
      });
    } else if (s.kind === 'brands') {
      if (brands?.length) out.push({ ...base, brands: brands.slice(0, 12) });
    } else {
      out.push(base);
    }
  }
  return { sections: out };
}

function brandFacet(gen) {
  return remember(
    `home:brands:${gen}`,
    POOL_TTL_SECONDS,
    async () => (await productService.publicList({ page: 1, limit: 1 })).facets.brands,
  );
}

/** Tests: start the next build from fresh lists. */
export function clearHomeCache() {
  return catalogGeneration.bump();
}
