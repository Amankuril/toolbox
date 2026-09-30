/**
 * Development seed: category tree, one approved demo vendor, products and home banners.
 * Images are generated and pushed through the real storage pipeline (sharp → webp → provider).
 *   npm run seed:catalog
 * Refuses to run in production.
 */
import sharp from 'sharp';
import { connectDatabase, disconnectDatabase } from '#config/db.js';
import { env } from '#config/env.js';
import { connectRedis, disconnectRedis } from '#config/redis.js';
import { slugify } from '#core/utils/strings.js';
import { Banner } from '#modules/banners/banner.model.js';
import { Category } from '#modules/categories/category.model.js';
import { Product } from '#modules/products/product.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { storageService } from '#services/storage/storage.service.js';

if (env.isProduction) {
  console.error('seed:catalog is for development only');
  process.exit(1);
}

const TREE = [
  ['Power Tools', ['Drills & Drivers', ['Impact Drills', 'Cordless Drills']], ['Grinders', ['Angle Grinders', 'Die Grinders']], ['Saws', []]],
  ['Hand Tools', ['Spanners & Wrenches', []], ['Pliers & Cutters', []], ['Measuring Tools', []]],
  ['Agricultural Machinery', ['Power Tillers', []], ['Sprayers', ['Battery Sprayers', 'Power Sprayers']], ['Brush Cutters', []]],
  ['Pumps & Motors', ['Monoblock Pumps', []], ['Submersible Pumps', []], ['Motors', []]],
  ['Industrial & MRO', ['Welding Machines', []], ['Air Compressors', []], ['Safety Equipment', []]],
  ['Spare Parts', ['Engine Parts', []], ['Pump Spares', []], ['Power Tool Spares', []]],
];

const COLORS = ['#e8590c', '#1b2a41', '#0f9d58', '#2563eb', '#b45309', '#7c3aed'];

function artwork({ title, subtitle, color, width = 1200, height = 1200 }) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f8fafc"/><stop offset="1" stop-color="#e2e8f0"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/>
    <circle cx="${width * 0.72}" cy="${height * 0.38}" r="${Math.min(width, height) * 0.26}" fill="${color}" opacity="0.14"/>
    <rect x="${width * 0.2}" y="${height * 0.26}" width="${width * 0.46}" height="${height * 0.26}" rx="28" fill="${color}"/>
    <rect x="${width * 0.6}" y="${height * 0.33}" width="${width * 0.2}" height="${height * 0.08}" rx="12" fill="#334155"/>
    <rect x="${width * 0.3}" y="${height * 0.5}" width="${width * 0.1}" height="${height * 0.18}" rx="14" fill="#334155"/>
    <text x="50%" y="${height * 0.82}" font-family="Inter, Arial, sans-serif" font-size="${Math.round(width / 18)}" font-weight="700" fill="#0f172a" text-anchor="middle">${esc(title)}</text>
    ${subtitle ? `<text x="50%" y="${height * 0.89}" font-family="Inter, Arial, sans-serif" font-size="${Math.round(width / 30)}" fill="#475569" text-anchor="middle">${esc(subtitle)}</text>` : ''}
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function bannerArt({ title, subtitle, color }) {
  const svg = `
  <svg xmlns="http://www.w3.org/2000/svg" width="1600" height="500">
    <defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="#1b2a41"/></linearGradient></defs>
    <rect width="100%" height="100%" fill="url(#b)"/>
    <circle cx="1350" cy="250" r="220" fill="#ffffff" opacity="0.08"/>
    <circle cx="1180" cy="120" r="90" fill="#ffffff" opacity="0.08"/>
    <text x="90" y="220" font-family="Inter, Arial, sans-serif" font-size="68" font-weight="800" fill="#ffffff">${title}</text>
    <text x="90" y="290" font-family="Inter, Arial, sans-serif" font-size="30" fill="#ffffff" opacity="0.85">${subtitle}</text>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function uploadArt(buffer, folder, name) {
  const media = await storageService.uploadImage({ buffer, originalname: `${slugify(name)}.png`, size: buffer.length }, { folder, uploadedBy: { kind: 'system' } });
  return { media: media._id, url: media.url, alt: name };
}

async function ensureCategory(name, parent, i) {
  const slug = slugify(name);
  const existing = await Category.findOne({ slug });
  if (existing) return existing;
  const image = parent ? undefined : await uploadArt(await artwork({ title: name, color: COLORS[i % COLORS.length], width: 600, height: 600 }), 'categories', name);
  return Category.create({
    name,
    slug,
    image,
    parent: parent?._id ?? null,
    ancestors: parent ? [...parent.ancestors, parent._id] : [],
    level: parent ? parent.level + 1 : 0,
    status: 'active',
    sortOrder: i,
    isFeatured: !parent,
    createdBy: { kind: 'system' },
  });
}

await Promise.all([connectDatabase(), connectRedis()]);

const bySlug = {};
for (const [i, [rootName, ...subs]] of TREE.entries()) {
  const root = await ensureCategory(rootName, null, i);
  bySlug[root.slug] = root;
  for (const [j, [subName, leaves]] of subs.entries()) {
    const sub = await ensureCategory(subName, root, j);
    bySlug[sub.slug] = sub;
    for (const [k, leafName] of leaves.entries()) bySlug[slugify(leafName)] = await ensureCategory(leafName, sub, k);
  }
}
console.log(`Categories: ${await Category.countDocuments()}`);

let vendor = await Vendor.findOne({ phone: '+919999900001' });
if (!vendor) {
  vendor = await Vendor.create({
    phone: '+919999900001',
    contactName: 'Demo Seller',
    email: 'demo-seller@toolbox.local',
    status: 'approved',
    store: { name: 'Shakti Industrial Supplies', slug: 'shakti-industrial-supplies', description: 'Authorised dealer for power tools, pumps and agri machinery since 1998.' },
    business: { legalName: 'Shakti Industrial Supplies Pvt Ltd', type: 'private_limited', gstin: '27AAPCS1234F1Z9', pan: 'AAPCS1234F' },
    address: { line1: 'Plot 22, MIDC Bhosari', city: 'Pune', state: 'Maharashtra', pincode: '411026' },
    onboarding: { completedSteps: ['business', 'address', 'bank', 'documents'], submittedAt: new Date() },
    review: { reviewedAt: new Date() },
  });
}

const PRODUCTS = [
  ['machinery', 'Bosch GSB 550 Impact Drill 13mm', 'impact-drills', 'Bosch', 450_000, 349_900, 25, [['Power', '550 W'], ['Chuck', '13 mm'], ['Speed', '0-2800 rpm']]],
  ['machinery', 'Dewalt DCD776 Cordless Drill Driver 18V', 'cordless-drills', 'Dewalt', 1_199_900, 889_900, 12, [['Voltage', '18 V'], ['Battery', '2 × 1.3 Ah Li-ion']]],
  ['machinery', 'Makita GA4030 Angle Grinder 100mm', 'angle-grinders', 'Makita', 520_000, 399_000, 30, [['Power', '720 W'], ['Disc', '100 mm']]],
  ['tool', 'Taparia Combination Spanner Set (8 pcs)', 'spanners-and-wrenches', 'Taparia', 165_000, 119_900, 80, [['Pieces', '8'], ['Sizes', '6-22 mm']]],
  ['tool', 'Stanley Digital Vernier Caliper 150mm', 'measuring-tools', 'Stanley', 320_000, 249_900, 18, [['Range', '0-150 mm'], ['Resolution', '0.01 mm']]],
  ['machinery', 'Kirloskar KS-128 Monoblock Pump 1HP', 'monoblock-pumps', 'Kirloskar', 890_000, 699_900, 10, [['Power', '1 HP'], ['Head', '32 m'], ['Phase', 'Single']]],
  ['machinery', 'Crompton 1.5HP V4 Submersible Pump', 'submersible-pumps', 'Crompton', 1_650_000, 1_349_000, 6, [['Power', '1.5 HP'], ['Stages', '10']]],
  ['machinery', 'Kisankraft KK-IC-8 Power Tiller 7HP', 'power-tillers', 'Kisankraft', 9_500_000, 7_899_000, 3, [['Engine', '7 HP diesel'], ['Tilling width', '800 mm']]],
  ['machinery', 'Neptune BS-13 Battery Sprayer 16L', 'battery-sprayers', 'Neptune', 450_000, 289_900, 40, [['Capacity', '16 L'], ['Battery', '12 V 8 Ah']]],
  ['machinery', 'Honda GX35 Brush Cutter 4-Stroke', 'brush-cutters', 'Honda', 2_800_000, 2_349_000, 7, [['Engine', '35.8 cc'], ['Shaft', 'Straight']]],
  ['machinery', 'Ador Champ 200 Inverter Welding Machine', 'welding-machines', 'Ador', 1_450_000, 1_099_000, 9, [['Current', '200 A'], ['Electrode', '1.6-4 mm']]],
  ['machinery', 'Elgi 2HP 50L Air Compressor', 'air-compressors', 'Elgi', 3_200_000, 2_649_000, 5, [['Tank', '50 L'], ['Pressure', '8 bar']]],
  ['tool', 'Karam Safety Helmet with Ratchet (Pack of 5)', 'safety-equipment', 'Karam', 200_000, 149_900, 120, [['Standard', 'IS 2925'], ['Pack', '5']]],
];

const PARTS = [
  ['Carbon Brush Pair for Bosch GSB 550', 'power-tool-spares', 'Bosch', 35_000, 24_900, 200, 'Bosch GSB 550 Impact Drill 13mm', ['GSB 550', 'GSB 500 RE']],
  ['Armature for Makita GA4030', 'power-tool-spares', 'Makita', 180_000, 129_900, 25, 'Makita GA4030 Angle Grinder 100mm', ['GA4030', 'GA4031']],
  ['Mechanical Seal Kit for KS-128', 'pump-spares', 'Kirloskar', 90_000, 64_900, 60, 'Kirloskar KS-128 Monoblock Pump 1HP', ['KS-128', 'KS-126']],
  ['Tiller Blade Set (24 pcs)', 'engine-parts', 'Kisankraft', 850_000, 689_000, 15, 'Kisankraft KK-IC-8 Power Tiller 7HP', ['KK-IC-8']],
];

let created = 0;
const nameToId = {};
for (const [i, [type, name, catSlug, brand, mrp, price, stock, specs]] of PRODUCTS.entries()) {
  const slug = slugify(name);
  let p = await Product.findOne({ slug });
  if (!p) {
    const cat = bySlug[catSlug];
    p = await Product.create({
      vendor: vendor._id,
      vendorApproved: true,
      category: cat._id,
      categoryPath: [...cat.ancestors, cat._id],
      type,
      name,
      slug,
      sku: `SKU-${1000 + i}`,
      brand,
      shortDescription: `${brand} ${type === 'tool' ? 'hand tool' : 'machine'} with manufacturer warranty and GST invoice.`,
      description: `${name} from ${brand}. Built for daily professional use. Ships with a GST invoice and manufacturer warranty. Bulk pricing available on request.`,
      images: [await uploadArt(await artwork({ title: brand, subtitle: name.replace(brand, '').trim().slice(0, 34), color: COLORS[i % COLORS.length] }), 'products', name)],
      pricing: { mrp, price, gstRate: 18 },
      hsnCode: '8467',
      inventory: { stock, moq: 1, unit: 'piece' },
      specifications: specs.map(([label, value]) => ({ label, value })),
      warranty: { months: 12, details: 'Manufacturer warranty' },
      shipping: { dispatchDays: 2 },
      status: 'active',
      isFeatured: i % 3 === 0,
      publishedAt: new Date(Date.now() - i * 3_600_000),
      moderation: { approvedAt: new Date() },
    });
    created += 1;
  }
  nameToId[name] = p._id;
}

for (const [i, [name, catSlug, brand, mrp, price, stock, fits, models]] of PARTS.entries()) {
  const slug = slugify(name);
  if (await Product.exists({ slug })) continue;
  const cat = bySlug[catSlug];
  await Product.create({
    vendor: vendor._id,
    vendorApproved: true,
    category: cat._id,
    categoryPath: [...cat.ancestors, cat._id],
    type: 'part',
    name,
    slug,
    sku: `SP-${2000 + i}`,
    brand,
    shortDescription: `Genuine ${brand} replacement part.`,
    images: [await uploadArt(await artwork({ title: 'Spare part', subtitle: name.slice(0, 34), color: '#475569' }), 'products', name)],
    pricing: { mrp, price, gstRate: 18 },
    inventory: { stock, moq: 1, unit: 'set' },
    compatibleWith: [nameToId[fits]],
    compatibleModels: models,
    status: 'active',
    publishedAt: new Date(),
    moderation: { approvedAt: new Date() },
  });
  created += 1;
}
console.log(`Products created: ${created}`);

if (!(await Banner.exists({}))) {
  const heroes = [
    ['Power tools for every job', 'Genuine brands · GST invoice · Pan-India delivery', '#e8590c', '/c/power-tools'],
    ['Farm machinery, delivered', 'Tillers, sprayers and brush cutters from trusted sellers', '#0f9d58', '/c/agricultural-machinery'],
  ];
  for (const [i, [title, subtitle, color, link]] of heroes.entries()) {
    await Banner.create({ title, subtitle, link, ctaLabel: 'Shop now', placement: 'home_hero', sortOrder: i, image: await uploadArt(await bannerArt({ title, subtitle, color }), 'banners', title) });
  }
  console.log('Banners created');
}

await Promise.all([disconnectDatabase(), disconnectRedis()]);
process.exit(0);
