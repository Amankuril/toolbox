import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Category } from '#modules/categories/category.model.js';
import { Product } from '#modules/products/product.model.js';
import { API, approvedVendor, bearer, createAdmin, setModeration, startTestApp, stopTestApp } from './helpers.js';

let app;
let category;
let drill;

const jsonLd = (html) => [...html.matchAll(/<script data-ssr type="application\/ld\+json">(.*?)<\/script>/g)].map((m) => JSON.parse(m[1]));

beforeAll(async () => {
  app = await startTestApp();
  const admin = await createAdmin(app);
  const vendor = await approvedVendor(app, admin.accessToken, { phone: '9600000021', storeName: 'Acme Tools' });
  await setModeration({ autoApproveProducts: true });
  category = (
    await request(app)
      .post(`${API}/admin/categories`)
      .set(bearer(admin.accessToken))
      .send({ name: 'Power tools', description: 'Drills, grinders and saws.' })
      .expect(201)
  ).body.data;
  drill = (
    await request(app)
      .post(`${API}/vendor/products`)
      .set(bearer(vendor.accessToken))
      .send({
        type: 'tool',
        name: 'Cordless drill 18V </script>',
        brand: 'Bosch',
        category: category._id,
        shortDescription: 'Compact drill for site work.',
        description: 'Two-speed gearbox.\n\nShips with two batteries.',
        pricing: { mrp: 500_000, price: 450_000, gstRate: 18 },
        hsnCode: '8467',
        inventory: { stock: 10, moq: 1 },
        specifications: [{ label: 'Voltage', value: '18 V' }],
        publish: true,
      })
      .expect(201)
  ).body.data;
});
afterAll(stopTestApp);

describe('crawlable storefront pages', () => {
  it('renders a product with its own title, canonical URL, structured data and content', async () => {
    const res = await request(app).get(`/p/${drill.slug}`).expect(200).expect('Content-Type', /html/);
    const html = res.text;

    expect(html).not.toContain('Static title');
    expect(html).not.toContain('Static description');
    expect(html).toContain('<title data-ssr>Cordless drill 18V &lt;/script&gt; | ToolsHubs</title>');
    expect(html).toContain(`<link data-ssr rel="canonical" href="https://shop.example.com/p/${drill.slug}">`);
    expect(html).toContain('content="Compact drill for site work."');
    expect(html).toContain('<h1>Cordless drill 18V &lt;/script&gt;</h1>');
    expect(html).toContain('<p>Ships with two batteries.</p>');
    expect(html).toContain('<a href="/c/power-tools">Power tools</a>');

    const [product, breadcrumbs] = jsonLd(html);
    expect(product).toMatchObject({
      '@type': 'Product',
      name: 'Cordless drill 18V </script>',
      brand: { name: 'Bosch' },
      offers: {
        '@type': 'Offer',
        priceCurrency: 'INR',
        price: '4500.00',
        availability: 'https://schema.org/InStock',
        seller: { name: 'Acme Tools' },
      },
    });
    expect(breadcrumbs.itemListElement.map((i) => i.name)).toEqual(['Home', 'Power tools', 'Cordless drill 18V </script>']);
  });

  it('renders categories and the home page with links crawlers can follow', async () => {
    const cat = (await request(app).get('/c/power-tools').expect(200)).text;
    expect(cat).toContain('<title data-ssr>Power tools | ToolsHubs</title>');
    expect(cat).toContain(`<a href="/p/${drill.slug}">`);

    const home = (await request(app).get('/').expect(200)).text;
    expect(jsonLd(home).map((d) => d['@type'])).toEqual(['Organization', 'WebSite']);
    expect(home).toContain('<a href="/c/power-tools">Power tools</a>');
  });

  it('answers 404 with noindex for hidden or unknown pages', async () => {
    await request(app).get('/p/no-such-thing').expect(404);
    await Category.updateOne({ _id: category._id }, { status: 'inactive' });
    const res = await request(app).get(`/p/${drill.slug}`).expect(404);
    expect(res.text).toContain('<meta data-ssr name="robots" content="noindex">');
    await Category.updateOne({ _id: category._id }, { status: 'active' });
  });

  it('serves robots.txt and a sitemap of public pages only', async () => {
    const robots = (await request(app).get('/robots.txt').expect(200)).text;
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Sitemap: https://shop.example.com/sitemap.xml');

    await Product.create({
      ...(await Product.findById(drill._id).lean()),
      _id: undefined,
      slug: 'draft-drill',
      sku: 'DRAFT-1',
      status: 'draft',
    });
    const sitemap = (await request(app).get('/sitemap.xml').expect(200).expect('Content-Type', /xml/)).text;
    expect(sitemap).toContain('<loc>https://shop.example.com/</loc>');
    expect(sitemap).toContain('<loc>https://shop.example.com/c/power-tools</loc>');
    expect(sitemap).toContain(`<loc>https://shop.example.com/p/${drill.slug}</loc>`);
    expect(sitemap).toContain('<loc>https://shop.example.com/store/');
    expect(sitemap).not.toContain('draft-drill');
  });
});

describe('SEO settings', () => {
  it('templates fill page titles and drop missing values', async () => {
    const { fillTemplate } = await import('#modules/seo/templates.js');
    expect(fillTemplate('{name} | {site}', { name: 'Pump', site: 'Shop' })).toBe('Pump | Shop');
    expect(fillTemplate('{brand} {name} | {site}', { name: 'Pump', site: 'Shop' })).toBe('Pump | Shop');
    expect(fillTemplate('Shop from {name}{city} on {site}.', { name: 'Acme', site: 'Shop' })).toBe('Shop from Acme on Shop.');
  });
});
