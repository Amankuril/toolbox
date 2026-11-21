import { logger } from '#config/logger.js';
import { Category } from '#modules/categories/category.model.js';
import { brandForPdf, C, createPdf, date, loadPdfImage, money } from '#modules/invoices/pdf.kit.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { availableQty, hasVariants, isTracked } from './inventory.js';
import { Product } from './product.model.js';
import { commonFilter } from './product.service.js';

/**
 * Product catalogue PDF for admins: one card per product (photo, name, codes, category, seller, description,
 * price, GST, stock, order quantities, variants, key specs), filtered like the admin product list.
 */

/** Photos are fetched over the network; past this the download would take minutes. */
export const CATALOG_MAX_PRODUCTS = 1000;
const IMAGE_CONCURRENCY = 8;

const STATUS_LABEL = { draft: 'Draft', pending: 'Pending review', active: 'Live', rejected: 'Rejected', inactive: 'Hidden', archived: 'Archived' };
const STATUS_COLOR = { active: C.PRIMARY, pending: '#b45309', rejected: '#b91c1c', draft: C.MUTED, inactive: C.MUTED, archived: C.MUTED };
const TYPE_LABEL = { tool: 'Tools', machinery: 'Machinery', part: 'Spare parts' };
const STOCK_LABEL = { in: 'In stock', out: 'Out of stock', low: 'Low stock' };

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
/** Rich-text description → plain text. */
export const plainText = (html) =>
  String(html ?? '')
    .replace(/<\/(p|div|li|h\d)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e) => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();

/** Runs `fn` over `list` with at most `n` in flight. */
async function mapPool(list, n, fn) {
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out;
}

const photoUrl = (p) => p.images?.[0]?.url ?? p.variants?.find((v) => v.image?.url)?.image.url;

async function photo(p) {
  const url = photoUrl(p);
  if (!url) return null;
  try {
    return await loadPdfImage(url, { resize: { width: 360, height: 360, fit: 'inside', withoutEnlargement: true }, format: 'jpeg' });
  } catch (err) {
    logger.warn({ err: err.message, url, product: String(p._id) }, 'catalogue photo could not be loaded');
    return null;
  }
}

function stockText(p) {
  if (p.inventory?.available === false) return { text: 'Not available', color: '#b91c1c' };
  if (!isTracked(p)) return { text: 'Available', color: C.PRIMARY };
  const qty = hasVariants(p) ? p.variants.reduce((n, v) => n + availableQty(p, v), 0) : availableQty(p);
  return qty > 0 ? { text: `In stock · ${qty.toLocaleString('en-IN')}`, color: C.PRIMARY } : { text: 'Out of stock', color: '#b91c1c' };
}

function variantSummary(p) {
  if (!hasVariants(p)) return null;
  const prices = p.variants.map((v) => v.price);
  const [lo, hi] = [Math.min(...prices), Math.max(...prices)];
  const options = (p.variantOptions ?? []).map((o) => `${o.name}: ${o.values.join(', ')}`).join('  ·  ');
  return `${p.variants.length} variants  ·  ${lo === hi ? money(lo) : `${money(lo)} – ${money(hi)}`}${options ? `\n${options}` : ''}`;
}

/** What the filters say, in words, for the cover line. */
async function describeFilters({ q, type, category, status, stock, vendor, featured }) {
  const parts = [];
  if (q) parts.push(`Search “${q}”`);
  if (status) parts.push(STATUS_LABEL[status]);
  if (type) parts.push(TYPE_LABEL[type]);
  if (category) parts.push((await Category.findById(category).select('name').lean())?.name ?? 'Category');
  if (vendor) parts.push((await Vendor.findById(vendor).select('store.name').lean())?.store?.name ?? 'Seller');
  if (stock) parts.push(STOCK_LABEL[stock]);
  if (featured !== undefined) parts.push(featured ? 'Featured' : 'Not featured');
  return parts.join('  ·  ');
}

/** @returns {Promise<{ filename: string, pdf: Buffer }>} */
export async function renderCatalogPdf(query = {}) {
  const { vendor, featured } = query;
  const filter = commonFilter(query);
  if (vendor) filter.vendor = vendor;
  if (featured !== undefined) filter.isFeatured = featured;

  const [products, total, brand, filterText] = await Promise.all([
    Product.find(filter)
      .sort({ name: 1, _id: 1 })
      .limit(CATALOG_MAX_PRODUCTS)
      .select(
        'name sku brand modelNumber type status shortDescription description images variants variantOptions pricing inventory specifications warranty condition category vendor isFeatured',
      )
      .populate('category', 'name')
      .populate('vendor', 'store.name')
      .lean(),
    Product.countDocuments(filter),
    brandForPdf(),
    describeFilters(query),
  ]);
  const photos = await mapPool(products, IMAGE_CONCURRENCY, photo);

  const now = new Date();
  const kit = createPdf({ info: { Title: `${brand.siteName} product catalogue` }, brand, runningTitle: 'Product catalogue' });
  const { doc, left, width } = kit;

  kit.header({
    eyebrow: null,
    title: 'PRODUCT CATALOGUE',
    subtitle: filterText ? 'Filtered selection' : 'All products',
    chip: [
      ['Products', total > products.length ? `${products.length} of ${total.toLocaleString('en-IN')}` : products.length.toLocaleString('en-IN')],
      ['Date', date(now)],
    ],
  });
  kit.facts([
    ['Filters', filterText || 'None: every product'],
    ['Products', products.length.toLocaleString('en-IN')],
    ['Prices', 'In ₹, including GST'],
  ]);
  if (total > products.length) {
    kit.text(`Only the first ${products.length} products (by name) are included. Narrow the filters to see the rest.`, left, kit.y - 6, {
      size: 7.5,
      color: '#b45309',
      width,
    });
    kit.y += 10;
  }
  if (!products.length) {
    kit.text('No products match these filters.', left, kit.y + 10, { font: 'bold', size: 11, color: C.MUTED, width, align: 'center' });
  }

  // Card geometry: photo | details | price panel.
  const pad = 10;
  const imgBox = 104;
  const priceW = 132;
  const midX = left + pad + imgBox + 14;
  const midW = width - (midX - left) - priceW - 12;
  const priceX = left + width - priceW;

  products.forEach((p, i) => {
    const description = p.shortDescription || plainText(p.description);
    const variants = variantSummary(p);
    const specs = (p.specifications ?? []).slice(0, 6);
    const codes = [p.brand && `Brand: ${p.brand}`, p.modelNumber && `Model: ${p.modelNumber}`, p.sku && `SKU: ${p.sku}`].filter(Boolean).join('   ');
    const placement = [p.category?.name, p.vendor?.store?.name && `Sold by ${p.vendor.store.name}`].filter(Boolean).join('   ·   ');

    // Height of the details column, with the description clamped to 4 lines.
    const descH = description ? Math.min(kit.measure(description, midW, { size: 8 }), 4 * 10.8) + 4 : 0;
    const specH = specs.length ? Math.ceil(specs.length / 2) * 11 + 6 : 0;
    const midH =
      kit.measure(p.name, midW, { font: 'bold', size: 10.5 }) +
      (codes ? kit.measure(codes, midW, { size: 7.3 }) + 2 : 0) +
      (placement ? kit.measure(placement, midW, { size: 7.3 }) + 2 : 0) +
      descH +
      (variants ? kit.measure(variants, midW, { size: 7.5 }) + 6 : 0) +
      specH +
      12;
    // Price panel: label + price, MRP/discount, GST, stock, MOQ, warranty, then the status line pinned below.
    const panelH =
      36 +
      (p.pricing?.mrp > p.pricing?.price ? 28 : 4) +
      (p.pricing?.gstRate != null ? 10 : 0) +
      26 +
      (p.warranty?.months ? 10 : 0) +
      24;
    const h = Math.max(imgBox + pad * 2, midH + pad, panelH + 16, 128);

    kit.ensure(h + 10);
    const y = kit.y;
    if (i % 2) doc.roundedRect(left, y, width, h, 6).fill(C.ZEBRA);
    doc.roundedRect(left, y, width, h, 6).lineWidth(0.7).strokeColor(C.RULE).stroke();
    doc.rect(left, y + 10, 3, h - 20).fill(C.PRIMARY);

    // Photo.
    const ix = left + pad + 3;
    const iy = y + (h - imgBox) / 2;
    doc.roundedRect(ix, iy, imgBox, imgBox, 4).fill('#ffffff');
    doc.roundedRect(ix, iy, imgBox, imgBox, 4).lineWidth(0.5).strokeColor(C.SOFT_RULE).stroke();
    if (photos[i]) {
      try {
        doc.image(photos[i], ix + 4, iy + 4, { fit: [imgBox - 8, imgBox - 8], align: 'center', valign: 'center' });
      } catch {
        kit.text('No photo', ix, iy + imgBox / 2 - 5, { size: 7.5, color: C.MUTED, width: imgBox, align: 'center' });
      }
    } else {
      kit.text('No photo', ix, iy + imgBox / 2 - 5, { size: 7.5, color: C.MUTED, width: imgBox, align: 'center' });
    }

    // Details.
    let cy = kit.text(p.name, midX, y + pad, { font: 'bold', size: 10.5, color: C.INK, width: midW });
    if (codes) cy = kit.text(codes, midX, cy + 2, { size: 7.3, color: C.MUTED, width: midW });
    if (placement) cy = kit.text(placement, midX, cy + 2, { size: 7.3, color: C.PRIMARY, width: midW });
    if (description) {
      kit.text(description, midX, cy + 4, { size: 8, color: C.BODY, width: midW, height: 4 * 10.8, ellipsis: true });
      cy += descH;
    }
    if (variants) cy = kit.text(variants, midX, cy + 5, { font: 'bold', size: 7.5, color: C.INK, width: midW });
    if (specs.length) {
      const colW = (midW - 8) / 2;
      cy += 6;
      specs.forEach((s, k) => {
        const sx = midX + (k % 2) * (colW + 8);
        const sy = cy + Math.floor(k / 2) * 11;
        kit.text(`${s.label}: ${s.value}`, sx, sy, { size: 7.2, color: C.BODY, width: colW, height: 10, ellipsis: true, lineBreak: false });
      });
    }

    // Price panel.
    const px = priceX;
    const py = y + 8;
    const ph = h - 16;
    doc.roundedRect(px, py, priceW - 8, ph, 5).fill(C.TINT);
    const pw = priceW - 24;
    const tx = px + 8;
    const { price, mrp, gstRate } = p.pricing ?? {};
    let ty = py + 8;
    kit.label(hasVariants(p) ? 'Price from' : 'Price', tx, ty, { width: pw });
    ty = kit.text(money(price), tx, ty + 9, { font: 'bold', size: 13, color: C.PRIMARY, width: pw, lineBreak: false });
    if (mrp > price) {
      const off = Math.round(((mrp - price) / mrp) * 100);
      kit.text(`MRP ${money(mrp)}`, tx, ty + 1, { size: 7.5, color: C.MUTED, width: pw, strike: true, lineBreak: false });
      doc.roundedRect(tx, ty + 12, 46, 12, 3).fill(C.ACCENT);
      kit.text(`${off}% OFF`, tx, ty + 14.2, { font: 'bold', size: 6.8, color: C.INK, width: 46, align: 'center', lineBreak: false });
      ty += 27;
    } else {
      ty += 4;
    }
    if (gstRate != null) ty = kit.text(`Incl. ${gstRate}% GST`, tx, ty + 1, { size: 7, color: C.MUTED, width: pw });
    const stock = stockText(p);
    ty = kit.text(stock.text, tx, ty + 5, { font: 'bold', size: 7.5, color: stock.color, width: pw });
    const unit = p.inventory?.unit ?? 'piece';
    ty = kit.text(`Min. order ${p.inventory?.moq ?? 1} ${unit}${(p.inventory?.moq ?? 1) === 1 ? '' : 's'}`, tx, ty + 2, {
      size: 7,
      color: C.BODY,
      width: pw,
    });
    if (p.warranty?.months) ty = kit.text(`Warranty ${p.warranty.months} months`, tx, ty + 1, { size: 7, color: C.BODY, width: pw });
    // Status pinned to the bottom of the panel.
    const status = STATUS_LABEL[p.status] ?? p.status;
    kit.text(`${status}${p.isFeatured ? '  ·  Featured' : ''}`, tx, py + ph - 14, {
      font: 'bold',
      size: 6.8,
      color: STATUS_COLOR[p.status] ?? C.MUTED,
      width: pw,
      lineBreak: false,
    });

    kit.y = y + h + 10;
  });

  const stamp = now.toISOString().slice(0, 10);
  const pdf = await kit.finish(`${brand.siteName} product catalogue  ·  Generated ${date(now)}  ·  Prices and stock as on this date`);
  return { filename: `Product-catalogue-${stamp}.pdf`, pdf };
}
