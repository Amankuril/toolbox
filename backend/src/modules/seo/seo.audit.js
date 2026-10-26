import { Category } from '#modules/categories/category.model.js';
import { pageService } from '#modules/pages/page.service.js';
import { Product } from '#modules/products/product.model.js';
import { settingsService } from '#services/settings/settings.service.js';
import { fillTemplate } from './templates.js';

/**
 * Checks for one product page, each with what to do about it. `weight` is how much it costs the score (of 100).
 * Fixable ones can be fixed from the SEO page itself.
 */
export const PRODUCT_CHECKS = {
  title_long: {
    weight: 8,
    fix: true,
    label: 'Title tag too long',
    tip: 'Google cuts titles after about 60 characters. Write a shorter title tag.',
  },
  title_short: {
    weight: 6,
    fix: true,
    label: 'Title tag too short',
    tip: 'Add the brand, model or key spec so the title says what it is (30–60 characters).',
  },
  meta_missing: {
    weight: 15,
    fix: true,
    label: 'No meta description',
    tip: 'Write a 70–160 character description: what it is, who it is for, why buy here.',
  },
  meta_short: {
    weight: 6,
    fix: true,
    label: 'Meta description too short',
    tip: 'Aim for 70–160 characters so Google shows a full snippet.',
  },
  meta_long: { weight: 4, fix: true, label: 'Meta description too long', tip: 'Google cuts it after about 160 characters.' },
  description_thin: {
    weight: 12,
    fix: false,
    label: 'Thin product description',
    tip: 'Write at least 300 characters: uses, features, what is in the box. Unique text ranks better than copied text.',
  },
  no_short_description: {
    weight: 6,
    fix: true,
    label: 'No short description',
    tip: 'A one-line summary shows near the price and in search snippets.',
  },
  few_images: {
    weight: 10,
    fix: false,
    label: 'Fewer than 3 photos',
    tip: 'Add photos from several angles; Google Images is a big source of visits.',
  },
  no_alt: {
    weight: 5,
    fix: false,
    label: 'Photos without alt text',
    tip: 'Describe each photo (e.g. "3HP petrol water pump, front view") for image search and accessibility.',
  },
  no_keywords: { weight: 10, fix: true, label: 'No search keywords', tip: 'Add phrases buyers type, like "3hp petrol water pump".' },
  no_brand: { weight: 4, fix: false, label: 'No brand', tip: 'Brand names are searched a lot. Set the brand on the product.' },
  few_specs: {
    weight: 6,
    fix: false,
    label: 'Fewer than 3 specifications',
    tip: 'Specs (power, size, weight…) show in Google results and help buyers compare.',
  },
  duplicate_title: {
    weight: 8,
    fix: true,
    label: 'Same title as another product',
    tip: 'Make each title unique: add the size, model or variant.',
  },
  shouting: {
    weight: 3,
    fix: true,
    label: 'Name in CAPITAL LETTERS',
    tip: 'Use normal capitalisation; all caps reads as shouting and looks spammy in results.',
  },
};

const MAX_SCAN = 5000;
const ISSUE_KEYS = Object.keys(PRODUCT_CHECKS);

const titleCase = (s) => s.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
const words = (s) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9.\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1);

/** What we'd write: a title, meta description, short description and keywords built from the product's own facts. */
function suggest(p, { site, templates, category }) {
  const name = /^[^a-z]*$/.test(p.name) && /[A-Z]{4,}/.test(p.name) ? titleCase(p.name) : p.name;
  const brand = p.brand && !name.toLowerCase().includes(p.brand.toLowerCase()) ? `${p.brand} ` : '';
  let title = `${brand}${name}`;
  if (title.length < 30 && category) title = `${title} – ${category}`;
  if (title.length > 60) title = `${title.slice(0, 57).replace(/\s+\S*$/, '')}…`;
  const specs = (p.specifications ?? []).slice(0, 2).map((s) => `${s.value} ${s.label.toLowerCase()}`);
  const price = p.pricing?.price ? ` at ₹${(p.pricing.price / 100).toLocaleString('en-IN')}` : '';
  let meta = fillTemplate(templates.description, { site, name: `${brand}${name}` });
  if (specs.length) meta = `${meta.replace(/\.$/, '')}: ${specs.join(', ')}${price}.`;
  if (meta.length > 160) meta = `${meta.slice(0, 157).replace(/\s+\S*$/, '')}…`;
  const base = words(`${p.brand ?? ''} ${p.name}`)
    .slice(0, 6)
    .join(' ');
  const keywords = [
    base,
    category && `${category.toLowerCase()}`,
    category && `buy ${category.toLowerCase()} online`,
    p.brand && `${p.brand.toLowerCase()} ${category?.toLowerCase() ?? ''}`.trim(),
    p.modelNumber && p.modelNumber.toLowerCase(),
  ].filter(Boolean);
  return {
    seoTitle: title,
    seoDescription: meta,
    shortDescription: p.shortDescription || `${brand}${name}${specs.length ? ` with ${specs.join(' and ')}` : ''}.`,
    searchKeywords: [...new Set(keywords)].slice(0, 8),
  };
}

function auditProduct(p, { titleCounts, templates, site }) {
  const title = p.seo?.title || fillTemplate(templates.product.title, { site, name: p.name, brand: p.brand });
  const meta = p.seo?.description || p.shortDescription || '';
  const issues = [];
  if (title.length > 60) issues.push('title_long');
  if (title.length < 30) issues.push('title_short');
  if (!meta) issues.push('meta_missing');
  else if (meta.length < 70) issues.push('meta_short');
  else if (meta.length > 160) issues.push('meta_long');
  if ((p.description ?? '').length < 300) issues.push('description_thin');
  if (!p.shortDescription) issues.push('no_short_description');
  if ((p.images?.length ?? 0) < 3) issues.push('few_images');
  if (p.images?.length && p.images.some((i) => !i.alt)) issues.push('no_alt');
  if (!p.searchKeywords?.length && !p.tags?.length) issues.push('no_keywords');
  if (!p.brand) issues.push('no_brand');
  if ((p.specifications?.length ?? 0) < 3) issues.push('few_specs');
  if (titleCounts.get(p.name.trim().toLowerCase()) > 1) issues.push('duplicate_title');
  if (/[A-Z]{4,}/.test(p.name) && p.name === p.name.toUpperCase()) issues.push('shouting');
  const score = Math.max(0, 100 - issues.reduce((s, k) => s + PRODUCT_CHECKS[k].weight, 0));
  return { title, meta, issues, score };
}

export const seoAudit = {
  /**
   * Every product in scope, scored, worst first. `vendorId` limits it to one seller (and the house store); admins see all.
   * Archived and rejected listings are skipped.
   */
  async products({ vendorId, vendor, issue, q, page, limit }) {
    const filter = { status: { $in: ['active', 'inactive', 'pending', 'draft'] } };
    if (vendorId || vendor) filter.vendor = vendorId ?? vendor;
    const [rows, seo, branding] = await Promise.all([
      Product.find(filter)
        .select(
          'name slug brand modelNumber shortDescription description images specifications tags searchKeywords seo pricing status category vendor',
        )
        .populate('category', 'name')
        .populate('vendor', 'store.name')
        .limit(MAX_SCAN)
        .lean(),
      settingsService.get('seo'),
      settingsService.get('branding'),
    ]);
    const site = branding.siteName;
    const titleCounts = new Map();
    for (const p of rows) titleCounts.set(p.name.trim().toLowerCase(), (titleCounts.get(p.name.trim().toLowerCase()) ?? 0) + 1);

    let audited = rows.map((p) => {
      const a = auditProduct(p, { titleCounts, templates: seo, site });
      return {
        _id: p._id,
        name: p.name,
        slug: p.slug,
        status: p.status,
        image: p.images?.[0]?.url ?? null,
        seller: p.vendor?.store?.name ?? null,
        category: p.category?.name ?? null,
        current: {
          seoTitle: p.seo?.title ?? '',
          seoDescription: p.seo?.description ?? '',
          shortDescription: p.shortDescription ?? '',
          searchKeywords: p.searchKeywords ?? [],
          ogTitle: p.seo?.ogTitle ?? '',
          ogDescription: p.seo?.ogDescription ?? '',
        },
        effective: { title: a.title, description: a.meta },
        issues: a.issues,
        score: a.score,
        suggestion: a.issues.length ? suggest(p, { site, templates: seo.product, category: p.category?.name }) : null,
      };
    });

    const summary = {
      products: audited.length,
      averageScore: audited.length ? Math.round(audited.reduce((s, p) => s + p.score, 0) / audited.length) : 100,
      good: audited.filter((p) => p.score >= 80).length,
      needsWork: audited.filter((p) => p.score >= 50 && p.score < 80).length,
      poor: audited.filter((p) => p.score < 50).length,
      issues: Object.fromEntries(ISSUE_KEYS.map((k) => [k, audited.filter((p) => p.issues.includes(k)).length])),
      truncated: rows.length >= MAX_SCAN,
    };

    if (issue) audited = audited.filter((p) => p.issues.includes(issue));
    if (q) audited = audited.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));
    audited.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name));
    const total = audited.length;
    return {
      items: audited.slice((page - 1) * limit, page * limit),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)), summary, checks: PRODUCT_CHECKS },
    };
  },

  /** Admins: storefront-wide checks (settings, categories, information pages). */
  async site() {
    const [seo, analytics, categories, pages] = await Promise.all([
      settingsService.get('seo'),
      settingsService.get('analytics'),
      Category.find({ status: 'active' }).select('name slug description image seo level').lean(),
      pageService.list(),
    ]);
    const checks = [
      {
        key: 'home_description',
        ok: seo.home.description.length >= 70,
        label: 'Home page meta description',
        tip: 'Write 70–160 characters in SEO settings → Home page.',
      },
      {
        key: 'home_og_image',
        ok: Boolean(seo.home.ogImage),
        label: 'Social share image',
        tip: 'Add a 1200×630 image in SEO settings → Home page → Social share, so shared links look good on WhatsApp.',
      },
      {
        key: 'analytics',
        ok: Boolean(analytics.gaMeasurementId),
        label: 'Google Analytics connected',
        tip: 'Add your GA4 Measurement ID in Settings → Analytics to see search traffic.',
      },
      {
        key: 'pages',
        ok: pages.every((p) => p.customised),
        label: 'Policy pages written for your business',
        tip:
          'Pages still on the starting text: ' +
          pages
            .filter((p) => !p.customised)
            .map((p) => p.title)
            .join(', '),
      },
    ];
    const weakCategories = categories
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        level: c.level,
        issues: [
          !(c.seo?.description || (c.description ?? '').length >= 70) && 'No description (shown on the category page and to Google)',
          !c.image && 'No image',
        ].filter(Boolean),
      }))
      .filter((c) => c.issues.length)
      .sort((a, b) => a.level - b.level);
    return {
      checks,
      categories: weakCategories.slice(0, 50),
      categoriesWithIssues: weakCategories.length,
      categoriesTotal: categories.length,
    };
  },
};
