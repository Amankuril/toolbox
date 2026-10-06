import { Category } from '#modules/categories/category.model.js';
import { generateSku } from '../inventory.js';
import { Product } from '../product.model.js';
import { vendorCreateProduct } from '../product.validation.js';
import { CellError, COLUMNS, COLUMN_KEYS, normalizeHeader } from './import.columns.js';
import { readSheet } from './import.sheets.js';

export const MAX_IMPORT_ROWS = 5000;
const MAX_IMAGES = 10;
const REQUIRED = COLUMNS.filter((c) => c.required).map((c) => c.key);

/* ─────────────── Categories ─────────────── */

const norm = (s) =>
  String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');

/**
 * Categories a vendor may list in, matched by slug, full path ("Pumps > Monoblock")
 * or a unique name. Built once per file.
 */
async function categoryResolver(vendorId) {
  const cats = await Category.find(
    { $or: [{ status: 'active' }, { owner: vendorId, status: { $ne: 'rejected' } }] },
    'name slug ancestors',
  ).lean();
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  const pathOf = (c) => [...c.ancestors.map((a) => byId.get(String(a))?.name ?? '?'), c.name].join(' > ');
  const bySlug = new Map();
  const byPath = new Map();
  const byName = new Map();
  for (const c of cats) {
    bySlug.set(norm(c.slug), c);
    byPath.set(norm(pathOf(c)), c);
    byName.set(norm(c.name), [...(byName.get(norm(c.name)) ?? []), c]);
  }
  return {
    pathOf,
    resolve(value) {
      const key = norm(value).replace(/\s*[>/]\s*/g, ' > ');
      const hit = bySlug.get(norm(value)) ?? byPath.get(key);
      if (hit) return { id: String(hit._id) };
      const named = byName.get(norm(value)) ?? [];
      if (named.length === 1) return { id: String(named[0]._id) };
      if (named.length > 1)
        return { error: `"${value}" matches ${named.length} categories. Use the full path, e.g. "${pathOf(named[0])}"` };
      return { error: `Unknown category "${value}". Use a category name, full path or slug from the category list.` };
    },
  };
}

/* ─────────────── Error locations ─────────────── */

const SNAKE = (s) => s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
const NESTED_PREFIX = {
  pricing: { mrp: 'mrp', price: 'price', gstRate: 'gst_rate' },
  warranty: { months: 'warranty_months', details: 'warranty_details' },
};

/** Maps a validation path (e.g. ["variants", 2, "price"]) to the sheet row and column it came from. */
function locate(path, rows) {
  const [head, second, third] = path;
  if (head === 'variants' && typeof second === 'number') {
    const column =
      third === 'options' ? 'option1_value' : third === 'image' ? 'variant_image_url' : `variant_${SNAKE(String(third ?? 'price'))}`;
    return { row: rows[second] ?? rows[0], column };
  }
  if (head === 'variantOptions') return { row: rows[0], column: `option${(second ?? 0) + 1}_${third === 'values' ? 'value' : 'name'}` };
  if (NESTED_PREFIX[head]?.[second]) return { row: rows[0], column: NESTED_PREFIX[head][second] };
  if (['inventory', 'shipping'].includes(head) && second) return { row: rows[0], column: SNAKE(String(second)) };
  if (head === 'hsnCode') return { row: rows[0], column: 'hsn_code' };
  return { row: rows[0], column: head ? SNAKE(String(head)) : undefined };
}

/* ─────────────── Row → product input ─────────────── */

const compact = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
};

function readCells(record, scope, rowNumber, issues) {
  const values = {};
  for (const c of COLUMNS) {
    if (c.scope !== scope && !(scope === 'product' && c.scope === 'group')) continue;
    try {
      values[c.key] = c.parse(record[c.key]);
    } catch (err) {
      if (!(err instanceof CellError)) throw err;
      issues.push({ row: rowNumber, column: c.key, message: err.message });
    }
  }
  return values;
}

/** Builds one product's input from its rows (one row, or every row of a handle). */
function buildItem(group, categories, issues) {
  const first = group.records[0];
  const p = readCells(first.record, 'product', first.row, issues);
  for (const key of REQUIRED)
    if (p[key] === undefined && !issues.some((i) => i.row === first.row && i.column === key)) {
      issues.push({ row: first.row, column: key, message: 'Required' });
    }

  let category;
  if (p.category) {
    const r = categories.resolve(p.category);
    if (r.error) issues.push({ row: first.row, column: 'category', message: r.error });
    else category = r.id;
  }

  const optionNames = [1, 2, 3].map((n) => p[`option${n}_name`]).filter(Boolean);
  const variants = [];
  if (optionNames.length) {
    for (const { record, row } of group.records) {
      const v = readCells(record, 'variant', row, issues);
      const options = optionNames.map((_, i) => v[`option${i + 1}_value`]);
      options.forEach(
        (val, i) => !val && issues.push({ row, column: `option${i + 1}_value`, message: `Enter a value for ${optionNames[i]}` }),
      );
      variants.push({
        options: options.map((o) => o ?? ''),
        price: v.variant_price,
        mrp: v.variant_mrp,
        sku: v.variant_sku,
        barcode: v.variant_barcode,
        stock: v.variant_stock,
        available: v.variant_available,
        weightKg: v.variant_weight_kg,
        _imageUrl: v.variant_image_url,
      });
    }
  } else if (group.records.length > 1) {
    issues.push({
      row: group.records[1].row,
      column: 'handle',
      message: 'Rows sharing a handle need option1_name on the first row (they become variants)',
    });
  }

  const variantOptions = optionNames.map((name, i) => ({ name, values: [...new Set(variants.map((v) => v.options[i]).filter(Boolean))] }));
  const priced = variants.filter((v) => Number.isInteger(v.price) && Number.isInteger(v.mrp)).sort((a, b) => a.price - b.price);
  const cheapest = priced[0];

  const input = {
    type: p.type,
    name: p.name,
    category,
    sku: p.sku,
    barcode: p.barcode,
    brand: p.brand,
    modelNumber: p.model_number,
    condition: p.condition,
    shortDescription: p.short_description,
    description: p.description,
    pricing: compact({ mrp: cheapest?.mrp ?? p.mrp, price: cheapest?.price ?? p.price, gstRate: p.gst_rate }),
    hsnCode: p.hsn_code,
    inventory:
      compact({
        trackQuantity: p.track_quantity,
        available: p.available,
        stock: p.stock,
        lowStockAlert: p.low_stock_alert,
        lowStockThreshold: p.low_stock_threshold,
        moq: p.moq,
        maxOrderQty: p.max_order_qty,
        unit: p.unit,
      }) ?? {},
    shipping: compact({
      weightKg: p.weight_kg,
      lengthCm: p.length_cm,
      widthCm: p.width_cm,
      heightCm: p.height_cm,
      dispatchDays: p.dispatch_days,
    }),
    warranty: compact({ months: p.warranty_months, details: p.warranty_details }),
    tags: p.tags,
    specifications: p.specifications,
    ...(variants.length ? { variantOptions, variants: variants.map(({ _imageUrl, ...v }) => compact(v)) } : {}),
    publish: p.publish ?? false,
  };

  const imageUrls = p.image_urls ?? [];
  if (imageUrls.length > MAX_IMAGES) issues.push({ row: first.row, column: 'image_urls', message: `Up to ${MAX_IMAGES} images` });
  const urls = [...imageUrls, ...variants.map((v) => v._imageUrl).filter(Boolean)];
  for (const u of urls) {
    // Relative paths are this store's own uploads (as exported with local storage).
    if (!/^(https?:\/\/|\/)[^\s]+$/i.test(u))
      issues.push({ row: first.row, column: 'image_urls', message: `Not a valid http(s) link: ${u.slice(0, 80)}` });
  }

  return { input, imageUrls: imageUrls.slice(0, MAX_IMAGES), variantImageUrls: variants.map((v) => v._imageUrl ?? '') };
}

/* ─────────────── File ─────────────── */

/**
 * Parses and validates a CSV or Excel sheet against the same rules as the product form.
 * Nothing is written to products here; the result is stored for the vendor to review.
 */
export async function parseImportFile({ buffer, originalname }, { vendorId, mode }) {
  const fileIssues = [];
  const records = await readSheet(buffer, originalname, { maxRows: MAX_IMPORT_ROWS + 2 });
  if (!records.length) return { fileIssues: [{ message: 'The file is empty' }], items: [], rowCount: 0 };

  const headers = records[0].map(normalizeHeader);
  const unknown = headers.filter((h) => h && !COLUMN_KEYS.includes(h));
  if (unknown.length) fileIssues.push({ row: 1, message: `Ignored unknown columns: ${unknown.slice(0, 10).join(', ')}` });
  const missing = REQUIRED.filter((k) => !headers.includes(k));
  if (missing.length) {
    fileIssues.push({
      row: 1,
      message: `Missing required columns: ${missing.join(', ')}. Download the template to see the expected headers.`,
    });
    return { fileIssues, items: [], rowCount: records.length - 1, fatal: true };
  }
  const dataRows = records.slice(1);
  if (dataRows.length > MAX_IMPORT_ROWS) {
    fileIssues.push({ message: `Up to ${MAX_IMPORT_ROWS} rows per file. Split the file and upload the rest separately.` });
    return { fileIssues, items: [], rowCount: dataRows.length, fatal: true };
  }

  // Group rows: a handle collects its rows; rows without one stand alone. Row numbers match the sheet (header = 1).
  const groups = new Map();
  dataRows.forEach((cells, i) => {
    if (cells.every((c) => String(c ?? '').trim() === '')) return;
    const record = Object.fromEntries(headers.map((h, j) => [h, cells[j]]));
    const handle = String(record.handle ?? '')
      .trim()
      .toLowerCase();
    const key = handle || `#${i}`;
    if (!groups.has(key)) groups.set(key, { handle: handle || undefined, records: [] });
    groups.get(key).records.push({ record, row: i + 2 });
  });

  const categories = await categoryResolver(vendorId);
  const built = [...groups.values()].map((group, index) => {
    const issues = [];
    const rows = group.records.map((r) => r.row);
    const { input, imageUrls, variantImageUrls } = buildItem(group, categories, issues);

    const parsed = vendorCreateProduct.body.safeParse(input);
    if (!parsed.success) {
      for (const zi of parsed.error.issues) {
        const where = locate(zi.path, rows);
        // A missing required cell is already reported once.
        if (!issues.some((i) => i.row === where.row && i.column === where.column)) issues.push({ ...where, message: zi.message });
      }
    }
    return {
      index,
      rows,
      handle: group.handle,
      name: input.name,
      issues,
      input: parsed.success ? parsed.data : input,
      imageUrls,
      variantImageUrls,
    };
  });

  // SKUs: unique within the file, and either new (create) or matched for update (upsert).
  const skuCounts = new Map();
  for (const it of built) if (it.input.sku) skuCounts.set(it.input.sku.toLowerCase(), (skuCounts.get(it.input.sku.toLowerCase()) ?? 0) + 1);
  const fileSkus = built.map((it) => it.input.sku).filter(Boolean);
  const existing = new Set(
    (await Product.find({ vendor: vendorId, sku: { $in: fileSkus }, status: { $ne: 'archived' } }, 'sku').lean()).map((p) =>
      p.sku.toLowerCase(),
    ),
  );
  for (const it of built) {
    const sku = it.input.sku?.toLowerCase();
    if (sku && skuCounts.get(sku) > 1)
      it.issues.push({ row: it.rows[0], column: 'sku', message: 'This SKU appears more than once in the file' });
    if (sku && mode === 'create' && existing.has(sku)) {
      it.issues.push({
        row: it.rows[0],
        column: 'sku',
        message: 'You already have a product with this SKU. Choose "Update existing products" to change it.',
      });
    }
    it.action = sku && existing.has(sku) ? 'update' : 'create';
    // Fix the SKU now so a retried import can't create the same product twice.
    if (!it.input.sku && it.action === 'create') it.input.sku = generateSku(it.input.name);
    it.sku = it.input.sku;
  }

  return { fileIssues, items: built, rowCount: dataRows.length, categoryPath: categories.pathOf };
}
