import { toPaise, toRupees } from '#core/utils/money.js';
import { GST_RATES, PRODUCT_CONDITIONS, PRODUCT_TYPES, PRODUCT_UNITS } from '../product.model.js';

/**
 * One table drives the template, the help text, parsing and export, so they never drift apart.
 * Money is written in rupees in the sheet and stored in paise.
 *
 * Variants follow Shopify's layout: rows sharing a `handle` are one product; the first row
 * carries the product details and every row carries one variant's options and price.
 */

const YES = new Set(['yes', 'y', 'true', '1']);
const NO = new Set(['no', 'n', 'false', '0']);

export class CellError extends Error {}

const text = (v) => (v === undefined || v === null ? '' : String(v).trim());
const blank = (v) => text(v) === '';

export const parse = {
  text: (v) => (blank(v) ? undefined : text(v)),
  bool(v) {
    if (blank(v)) return undefined;
    const s = text(v).toLowerCase();
    if (YES.has(s)) return true;
    if (NO.has(s)) return false;
    throw new CellError('Use yes or no');
  },
  int(v) {
    if (blank(v)) return undefined;
    const n = Number(text(v).replace(/,/g, ''));
    if (!Number.isInteger(n)) throw new CellError('Must be a whole number');
    return n;
  },
  number(v) {
    if (blank(v)) return undefined;
    const n = Number(text(v).replace(/,/g, ''));
    if (!Number.isFinite(n)) throw new CellError('Must be a number');
    return n;
  },
  /** "₹7,850.50" → 785050 paise. */
  money(v) {
    if (blank(v)) return undefined;
    const s = text(v).replace(/[₹,\s]|^rs\.?/gi, '');
    if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new CellError('Enter an amount in rupees, e.g. 7850 or 7850.50');
    return toPaise(s);
  },
  oneOf(values) {
    return (v) => {
      if (blank(v)) return undefined;
      const s = text(v).toLowerCase();
      if (!values.includes(s)) throw new CellError(`Use one of: ${values.join(', ')}`);
      return s;
    };
  },
  /** Split on "|" (or new lines); commas are allowed too for tags. */
  list(separator = /\s*[|\n]\s*/) {
    return (v) =>
      blank(v)
        ? undefined
        : text(v)
            .split(separator)
            .map((s) => s.trim())
            .filter(Boolean);
  },
  /** "Power: 550 W | Voltage: 230 V" */
  specs(v) {
    if (blank(v)) return undefined;
    return text(v)
      .split(/\s*[|\n]\s*/)
      .filter(Boolean)
      .map((pair) => {
        const i = pair.indexOf(':');
        if (i < 1) throw new CellError('Write specifications as "Label: Value | Label: Value"');
        return { label: pair.slice(0, i).trim(), value: pair.slice(i + 1).trim() };
      });
  },
};

const fmt = {
  money: (v) => (v === undefined || v === null ? '' : toRupees(v)),
  bool: (v) => (v === undefined || v === null ? '' : v ? 'yes' : 'no'),
  list: (v) => (v?.length ? v.join(' | ') : ''),
};

/**
 * `key` is the CSV header. `scope: 'product'` columns are read from the first row of a handle
 * group; `scope: 'variant'` columns from every row.
 */
export const COLUMNS = [
  {
    key: 'handle',
    scope: 'group',
    help: 'Optional. Rows with the same handle become one product with variants. Leave empty for single products.',
    example: 'work-gloves',
  },
  {
    key: 'sku',
    scope: 'product',
    help: 'Your product code. Leave empty to auto-generate. With "Update existing", rows are matched to products by SKU.',
    example: 'WG-100',
  },
  { key: 'name', scope: 'product', required: true, help: 'Product name (max 200 characters).', example: 'Nitrile Work Gloves' },
  {
    key: 'type',
    scope: 'product',
    required: true,
    help: `One of: ${PRODUCT_TYPES.join(', ')}.`,
    example: 'tool',
    parse: parse.oneOf(PRODUCT_TYPES),
  },
  {
    key: 'category',
    scope: 'product',
    required: true,
    help: 'Category name, full path (Pumps > Monoblock) or slug.',
    example: 'Safety Gear',
  },
  { key: 'brand', scope: 'product', example: 'Karam' },
  { key: 'model_number', scope: 'product', example: 'WG-N100' },
  {
    key: 'condition',
    scope: 'product',
    help: `One of: ${PRODUCT_CONDITIONS.join(', ')}. Default new.`,
    example: 'new',
    parse: parse.oneOf(PRODUCT_CONDITIONS),
  },
  { key: 'short_description', scope: 'product', example: 'Oil-resistant gloves for workshop use' },
  { key: 'description', scope: 'product', example: '' },
  { key: 'mrp', scope: 'product', help: 'In rupees. Required unless the product has variants.', example: '499', parse: parse.money },
  {
    key: 'price',
    scope: 'product',
    help: 'Selling price in rupees (GST included). Required unless the product has variants.',
    example: '399',
    parse: parse.money,
  },
  { key: 'gst_rate', scope: 'product', required: true, help: `GST % - one of ${GST_RATES.join(', ')}.`, example: '18', parse: parse.int },
  { key: 'hsn_code', scope: 'product', required: true, help: 'HSN/SAC code: 4, 6 or 8 digits.', example: '6116' },
  { key: 'barcode', scope: 'product', help: 'UPC, EAN, GTIN or ISBN.', example: '' },
  { key: 'track_quantity', scope: 'product', help: 'yes or no. Default yes.', example: 'yes', parse: parse.bool },
  { key: 'stock', scope: 'product', help: 'Quantity in stock (single products with tracking on).', example: '', parse: parse.int },
  { key: 'available', scope: 'product', help: 'yes or no. Default yes. "no" stops sales.', example: 'yes', parse: parse.bool },
  { key: 'low_stock_alert', scope: 'product', help: 'yes to show buyers "Only N left".', example: 'no', parse: parse.bool },
  {
    key: 'low_stock_threshold',
    scope: 'product',
    help: 'Show the alert at or below this many units. Default 5.',
    example: '',
    parse: parse.int,
  },
  {
    key: 'unit',
    scope: 'product',
    help: `One of: ${PRODUCT_UNITS.join(', ')}. Default piece.`,
    example: 'pair',
    parse: parse.oneOf(PRODUCT_UNITS),
  },
  { key: 'moq', scope: 'product', help: 'Minimum order quantity. Default 1.', example: '1', parse: parse.int },
  { key: 'max_order_qty', scope: 'product', example: '', parse: parse.int },
  { key: 'weight_kg', scope: 'product', example: '0.2', parse: parse.number },
  { key: 'length_cm', scope: 'product', example: '', parse: parse.number },
  { key: 'width_cm', scope: 'product', example: '', parse: parse.number },
  { key: 'height_cm', scope: 'product', example: '', parse: parse.number },
  { key: 'dispatch_days', scope: 'product', example: '2', parse: parse.int },
  { key: 'warranty_months', scope: 'product', example: '', parse: parse.int },
  { key: 'warranty_details', scope: 'product', example: '' },
  { key: 'tags', scope: 'product', help: 'Separate with | or commas.', example: 'gloves, safety', parse: parse.list(/\s*[|,\n]\s*/) },
  {
    key: 'specifications',
    scope: 'product',
    help: 'Label: Value pairs separated by |',
    example: 'Material: Nitrile | Size range: M-XL',
    parse: parse.specs,
  },
  {
    key: 'image_urls',
    scope: 'product',
    help: 'Up to 10 public image links separated by |. The first is the cover photo.',
    example: 'https://example.com/gloves-1.jpg',
    parse: parse.list(),
  },
  {
    key: 'publish',
    scope: 'product',
    help: 'yes to submit for review / go live, no to save as draft. Default no.',
    example: 'yes',
    parse: parse.bool,
  },
  { key: 'option1_name', scope: 'product', help: 'Variant option, e.g. Size. Set on the first row of the handle.', example: 'Size' },
  { key: 'option1_value', scope: 'variant', help: 'This row’s value for option 1.', example: 'M' },
  { key: 'option2_name', scope: 'product', example: 'Colour' },
  { key: 'option2_value', scope: 'variant', example: 'Blue' },
  { key: 'option3_name', scope: 'product', example: '' },
  { key: 'option3_value', scope: 'variant', example: '' },
  { key: 'variant_sku', scope: 'variant', help: 'Leave empty to auto-generate.', example: '' },
  { key: 'variant_price', scope: 'variant', help: 'Variant selling price in rupees.', example: '399', parse: parse.money },
  { key: 'variant_mrp', scope: 'variant', example: '499', parse: parse.money },
  { key: 'variant_stock', scope: 'variant', example: '50', parse: parse.int },
  { key: 'variant_barcode', scope: 'variant', example: '' },
  { key: 'variant_weight_kg', scope: 'variant', example: '', parse: parse.number },
  { key: 'variant_available', scope: 'variant', help: 'yes or no. Default yes.', example: 'yes', parse: parse.bool },
  { key: 'variant_image_url', scope: 'variant', example: '', parse: parse.text },
].map((c) => ({ parse: parse.text, ...c }));

export const COLUMN_KEYS = COLUMNS.map((c) => c.key);

/** Accepts "Model Number", "model-number", "MODEL_NUMBER"… */
export const normalizeHeader = (h) =>
  text(h)
    .replace(/^\uFEFF/, '')
    .toLowerCase()
    .replace(/\*$/, '')
    .replace(/[\s-]+/g, '_');

/** Product → CSV rows in the same layout as the template (used by export). */
export function productToRows(p, categoryPathName) {
  const productCells = {
    handle: p.variants?.length ? p.slug : '',
    sku: p.sku ?? '',
    name: p.name,
    type: p.type,
    category: categoryPathName ?? '',
    brand: p.brand ?? '',
    model_number: p.modelNumber ?? '',
    condition: p.condition ?? '',
    short_description: p.shortDescription ?? '',
    description: p.description ?? '',
    mrp: p.variants?.length ? '' : fmt.money(p.pricing?.mrp),
    price: p.variants?.length ? '' : fmt.money(p.pricing?.price),
    gst_rate: p.pricing?.gstRate ?? '',
    hsn_code: p.hsnCode ?? '',
    barcode: p.barcode ?? '',
    track_quantity: fmt.bool(p.inventory?.trackQuantity !== false),
    stock: p.variants?.length || p.inventory?.trackQuantity === false ? '' : (p.inventory?.stock ?? 0),
    available: fmt.bool(p.inventory?.available !== false),
    low_stock_alert: fmt.bool(Boolean(p.inventory?.lowStockAlert)),
    low_stock_threshold: p.inventory?.lowStockThreshold ?? '',
    unit: p.inventory?.unit ?? '',
    moq: p.inventory?.moq ?? '',
    max_order_qty: p.inventory?.maxOrderQty ?? '',
    weight_kg: p.shipping?.weightKg ?? '',
    length_cm: p.shipping?.lengthCm ?? '',
    width_cm: p.shipping?.widthCm ?? '',
    height_cm: p.shipping?.heightCm ?? '',
    dispatch_days: p.shipping?.dispatchDays ?? '',
    warranty_months: p.warranty?.months ?? '',
    warranty_details: p.warranty?.details ?? '',
    tags: fmt.list(p.tags),
    specifications: (p.specifications ?? []).map((s) => `${s.label}: ${s.value}`).join(' | '),
    image_urls: fmt.list((p.images ?? []).map((i) => i.url)),
    publish: fmt.bool(['active', 'pending'].includes(p.status)),
  };
  (p.variantOptions ?? []).forEach((o, i) => (productCells[`option${i + 1}_name`] = o.name));
  if (!p.variants?.length) return [productCells];

  return p.variants.map((v, idx) => {
    const row = idx === 0 ? { ...productCells } : { handle: productCells.handle };
    v.options.forEach((value, i) => (row[`option${i + 1}_value`] = value));
    Object.assign(row, {
      variant_sku: v.sku ?? '',
      variant_price: fmt.money(v.price),
      variant_mrp: fmt.money(v.mrp),
      variant_stock: p.inventory?.trackQuantity === false ? '' : (v.stock ?? 0),
      variant_barcode: v.barcode ?? '',
      variant_weight_kg: v.weightKg ?? '',
      variant_available: fmt.bool(v.available !== false),
      variant_image_url: v.image?.url ?? '',
    });
    return row;
  });
}
