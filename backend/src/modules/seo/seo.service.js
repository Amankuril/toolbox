import { env } from '#config/env.js';
import { cached } from '#core/cache/cached.js';
import { Category } from '#modules/categories/category.model.js';
import { isInStock } from '#modules/products/inventory.js';
import { Product } from '#modules/products/product.model.js';
import { VISIBLE } from '#modules/products/product.service.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { settingsService } from '#services/settings/settings.service.js';

/** Storefront paths crawlers should skip: private, per-visitor or endlessly varied by query string. */
const PRIVATE_PATHS = [
  '/admin',
  '/vendor',
  '/account',
  '/checkout',
  '/cart',
  '/wishlist',
  '/compare',
  '/login',
  '/onboarding',
  '/search',
  '/api/',
];
const LISTING_LINKS = 48;
const SITEMAP_MAX_URLS = 50_000;

export const absoluteUrl = (pathOrUrl) => (/^https?:\/\//i.test(pathOrUrl) ? pathOrUrl : `${env.PUBLIC_APP_URL}${pathOrUrl}`);

/** One line of plain text, cut at a word boundary: what search results show under the title. */
export function snippet(text, max = 160) {
  const clean = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  return `${cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : cut.length)}…`;
}

const rupees = (paise) => (paise / 100).toFixed(2);
const inr = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const CONDITION = { new: 'NewCondition', refurbished: 'RefurbishedCondition', used: 'UsedCondition' };

function breadcrumbList(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({ '@type': 'ListItem', position: i + 1, name: item.name, item: absoluteUrl(item.path) })),
  };
}

async function branding() {
  const { siteName, modules } = await settingsService.get('branding');
  return { siteName, logo: modules.user.logo?.url ? absoluteUrl(modules.user.logo.url) : absoluteUrl('/toolboxlogo.jpeg') };
}

/** Breadcrumb trail for a category path, or null when any category on it is hidden. */
async function trail(ids) {
  const cats = await Category.find({ _id: { $in: ids } })
    .select('name slug level status')
    .lean();
  if (cats.length !== ids.length || cats.some((c) => c.status !== 'active')) return null;
  return cats.sort((a, b) => a.level - b.level).map((c) => ({ name: c.name, path: `/c/${c.slug}` }));
}

const productLinks = (products) => products.map((p) => ({ name: p.name, path: `/p/${p.slug}`, price: p.pricing.price }));

/**
 * What a crawler needs for one storefront URL: title, description, canonical URL, social image,
 * structured data, and a plain HTML version of the page's main content.
 * Returns `{ status: 404 }` (plus a title) for anything that isn't public.
 */
export const seoService = {
  async home() {
    const { siteName, logo } = await branding();
    const [categories, featured] = await Promise.all([
      Category.find({ status: 'active', level: 0 }).sort({ sortOrder: 1, name: 1 }).select('name slug').lean(),
      Product.find({ ...VISIBLE })
        .sort({ isFeatured: -1, publishedAt: -1 })
        .limit(LISTING_LINKS)
        .select('name slug pricing')
        .lean(),
    ]);
    const description =
      'Buy tools, machinery and spare parts from reviewed sellers across India, with bulk pricing and quotes for business buyers.';
    return {
      siteName,
      // Same as the home page's own title (frontend HomePage.jsx).
      title: `${siteName} — Tools for a Greener Tomorrow`,
      description: snippet(description),
      path: '/',
      image: logo,
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: siteName,
          url: absoluteUrl('/'),
          logo,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: siteName,
          url: absoluteUrl('/'),
          potentialAction: {
            '@type': 'SearchAction',
            target: { '@type': 'EntryPoint', urlTemplate: absoluteUrl('/search?q={search_term_string}') },
            'query-input': 'required name=search_term_string',
          },
        },
      ],
      content: {
        heading: siteName,
        intro: description,
        sections: [
          { heading: 'Shop by department', links: categories.map((c) => ({ name: c.name, path: `/c/${c.slug}` })) },
          { heading: 'Popular products', links: productLinks(featured) },
        ],
      },
    };
  },

  async product(slug) {
    const { siteName } = await branding();
    const p = await Product.findOne({ slug, ...VISIBLE })
      .populate('vendor', 'store.name store.slug')
      .lean();
    const crumbs = p && (await trail(p.categoryPath));
    if (!p || !crumbs) return { status: 404, title: `Product not found | ${siteName}` };

    const path = `/p/${p.slug}`;
    const images = p.images.map((img) => absoluteUrl(img.url));
    const inStock = isInStock(p);
    const prices = p.variants?.length ? p.variants.map((v) => v.price) : [p.pricing.price];
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    const availability = `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`;
    const seller = p.vendor?.store?.name ? { '@type': 'Organization', name: p.vendor.store.name } : undefined;
    const description = p.seo?.description || p.shortDescription || snippet(p.description) || `Buy ${p.name} on ${siteName}.`;

    const product = {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: p.name,
      url: absoluteUrl(path),
      image: images.length ? images : undefined,
      description: snippet(p.description || description, 5000),
      sku: p.sku || undefined,
      mpn: p.modelNumber || undefined,
      gtin: p.barcode || undefined,
      brand: p.brand ? { '@type': 'Brand', name: p.brand } : undefined,
      category: crumbs.at(-1)?.name,
      itemCondition: `https://schema.org/${CONDITION[p.condition] ?? 'NewCondition'}`,
      offers:
        low === high
          ? { '@type': 'Offer', url: absoluteUrl(path), priceCurrency: 'INR', price: rupees(low), availability, seller }
          : {
              '@type': 'AggregateOffer',
              priceCurrency: 'INR',
              lowPrice: rupees(low),
              highPrice: rupees(high),
              offerCount: prices.length,
              availability,
              seller,
            },
      aggregateRating: p.rating?.count
        ? {
            '@type': 'AggregateRating',
            ratingValue: Number(p.rating.average.toFixed(1)),
            reviewCount: p.rating.count,
            bestRating: 5,
            worstRating: 1,
          }
        : undefined,
      additionalProperty: p.specifications?.length
        ? p.specifications.map((s) => ({ '@type': 'PropertyValue', name: s.label, value: s.value }))
        : undefined,
    };

    return {
      siteName,
      title: `${p.seo?.title || p.name} | ${siteName}`,
      description: snippet(description),
      path,
      image: images[0],
      imageAlt: p.images[0]?.alt || p.name,
      ogType: 'product',
      price: { amount: rupees(low), currency: 'INR' },
      jsonLd: [product, breadcrumbList([{ name: 'Home', path: '/' }, ...crumbs, { name: p.name, path }])],
      content: {
        breadcrumbs: crumbs,
        heading: p.name,
        image: images[0] && { src: images[0], alt: p.images[0]?.alt || p.name },
        facts: [
          p.brand && `Brand: ${p.brand}`,
          p.modelNumber && `Model: ${p.modelNumber}`,
          `Price: ${low === high ? inr(low) : `${inr(low)} – ${inr(high)}`}`,
          inStock ? 'In stock' : 'Out of stock',
          p.vendor?.store?.name && `Sold by ${p.vendor.store.name}`,
        ].filter(Boolean),
        intro: p.shortDescription,
        body: p.description,
        specs: p.specifications ?? [],
      },
    };
  },

  async category(slug) {
    const { siteName } = await branding();
    const category = await Category.findOne({ slug, status: 'active' }).select('name slug description image ancestors seo').lean();
    const crumbs = category && (await trail(category.ancestors));
    if (!category || !crumbs) return { status: 404, title: `Department not found | ${siteName}` };

    const path = `/c/${category.slug}`;
    const [children, products] = await Promise.all([
      Category.find({ parent: category._id, status: 'active' }).sort({ sortOrder: 1, name: 1 }).select('name slug').lean(),
      Product.find({ ...VISIBLE, categoryPath: category._id })
        .sort({ isFeatured: -1, publishedAt: -1 })
        .limit(LISTING_LINKS)
        .select('name slug pricing')
        .lean(),
    ]);
    const description =
      category.seo?.description ||
      category.description ||
      `Shop ${category.name} online at ${siteName}: compare prices from reviewed sellers, with bulk pricing and quotes.`;

    return {
      siteName,
      title: `${category.seo?.title || category.name} | ${siteName}`,
      description: snippet(description),
      path,
      image: category.image?.url && absoluteUrl(category.image.url),
      jsonLd: [
        breadcrumbList([{ name: 'Home', path: '/' }, ...crumbs, { name: category.name, path }]),
        {
          '@context': 'https://schema.org',
          '@type': 'ItemList',
          itemListElement: products.map((p, i) => ({
            '@type': 'ListItem',
            position: i + 1,
            url: absoluteUrl(`/p/${p.slug}`),
            name: p.name,
          })),
        },
      ],
      content: {
        breadcrumbs: crumbs,
        heading: category.name,
        intro: category.description,
        sections: [
          { heading: 'Sub-categories', links: children.map((c) => ({ name: c.name, path: `/c/${c.slug}` })) },
          { heading: `${category.name} products`, links: productLinks(products) },
        ],
      },
    };
  },

  async store(slug) {
    const { siteName } = await branding();
    const vendor = await Vendor.findOne({ 'store.slug': slug, status: 'approved' }).select('store address.city address.state').lean();
    if (!vendor) return { status: 404, title: `Store not found | ${siteName}` };

    const path = `/store/${vendor.store.slug}`;
    const products = await Product.find({ ...VISIBLE, vendor: vendor._id })
      .sort({ 'rating.count': -1, publishedAt: -1 })
      .limit(LISTING_LINKS)
      .select('name slug pricing')
      .lean();
    const place = [vendor.address?.city, vendor.address?.state].filter(Boolean).join(', ');
    const description =
      vendor.store.description ||
      `Shop tools, machinery and spare parts from ${vendor.store.name}${place ? ` (${place})` : ''} on ${siteName}.`;

    return {
      siteName,
      title: `${vendor.store.name} | ${siteName}`,
      description: snippet(description),
      path,
      image: vendor.store.logo?.url && absoluteUrl(vendor.store.logo.url),
      jsonLd: [
        {
          '@context': 'https://schema.org',
          '@type': 'Store',
          name: vendor.store.name,
          url: absoluteUrl(path),
          image: vendor.store.logo?.url ? absoluteUrl(vendor.store.logo.url) : undefined,
          address: place
            ? { '@type': 'PostalAddress', addressLocality: vendor.address.city, addressRegion: vendor.address.state, addressCountry: 'IN' }
            : undefined,
        },
      ],
      content: {
        heading: vendor.store.name,
        intro: vendor.store.description,
        sections: [{ heading: `Products from ${vendor.store.name}`, links: productLinks(products) }],
      },
    };
  },

  robots() {
    return [
      'User-agent: *',
      ...PRIVATE_PATHS.map((p) => `Disallow: ${p}`),
      'Allow: /',
      '',
      `Sitemap: ${absoluteUrl('/sitemap.xml')}`,
      '',
    ].join('\n');
  },

  sitemap: () => sitemap.get(),
};

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

// Rebuilt at most every 30 minutes; crawlers fetch it a few times a day at most.
const sitemap = cached(
  'seo:sitemap',
  async () => {
    const [categories, products, stores] = await Promise.all([
      Category.find({}).select('slug status ancestors updatedAt').lean(),
      Product.find({ ...VISIBLE })
        .sort({ publishedAt: -1 })
        .limit(SITEMAP_MAX_URLS)
        .select('slug categoryPath updatedAt')
        .lean(),
      Vendor.find({ status: 'approved', 'store.slug': { $type: 'string' } })
        .select('store.slug updatedAt')
        .lean(),
    ]);

    // A category (and anything filed under it) is public only when it and every ancestor is active.
    const active = new Set(categories.filter((c) => c.status === 'active').map((c) => String(c._id)));
    const allActive = (ids) => ids.every((id) => active.has(String(id)));

    const urls = [
      { path: '/', changefreq: 'daily', priority: '1.0' },
      ...categories
        .filter((c) => c.status === 'active' && allActive(c.ancestors))
        .map((c) => ({ path: `/c/${c.slug}`, lastmod: c.updatedAt, changefreq: 'daily', priority: '0.8' })),
      ...products
        .filter((p) => allActive(p.categoryPath))
        .map((p) => ({ path: `/p/${p.slug}`, lastmod: p.updatedAt, changefreq: 'weekly', priority: '0.7' })),
      ...stores.map((v) => ({ path: `/store/${v.store.slug}`, lastmod: v.updatedAt, changefreq: 'weekly', priority: '0.5' })),
    ].slice(0, SITEMAP_MAX_URLS);

    const entries = urls.map(
      (u) =>
        `  <url><loc>${xmlEscape(absoluteUrl(u.path))}</loc>${u.lastmod ? `<lastmod>${new Date(u.lastmod).toISOString()}</lastmod>` : ''}<changefreq>${u.changefreq}</changefreq><priority>${u.priority}</priority></url>`,
    );
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join('\n')}\n</urlset>\n`;
  },
  30 * 60_000,
);
