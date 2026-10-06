import crypto from 'node:crypto';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Category } from '#modules/categories/category.model.js';
import { Media } from '#modules/media/media.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { downloadRemoteImage } from '#services/storage/remoteImage.js';
import { storageService } from '#services/storage/storage.service.js';
import { GST_RATES, Product } from '../product.model.js';
import { productService } from '../product.service.js';
import { COLUMNS, COLUMN_KEYS, productToRows } from './import.columns.js';
import { ProductImport, ProductImportItem } from './import.model.js';
import { parseImportFile } from './import.parser.js';
import { toCsv, toXlsx } from './import.sheets.js';

const WORKER_ID = `${process.pid}-${crypto.randomBytes(3).toString('hex')}`;
const LEASE_MS = 60_000;
const ITEM_CONCURRENCY = 4;
const MAX_ITEM_ATTEMPTS = 3;
const MAX_ACTIVE_IMPORTS = 3;
const MAX_STORED_ISSUES = 50;

/* ─────────────── Serialisation ─────────────── */

function serializeImport(doc) {
  const i = doc.toObject?.() ?? doc;
  const done = i.counts.created + i.counts.updated + i.counts.failed;
  return {
    _id: i._id,
    vendor: i.vendor?.store ? { _id: i.vendor._id, storeName: i.vendor.store.name } : i.vendor,
    createdBy: i.createdBy?.kind ?? 'vendor',
    fileName: i.fileName,
    mode: i.mode,
    status: i.status,
    counts: i.counts,
    progress: i.counts.valid ? Math.min(100, Math.round((done / i.counts.valid) * 100)) : 100,
    fileIssues: i.fileIssues ?? [],
    error: i.error ?? null,
    startedAt: i.startedAt ?? null,
    finishedAt: i.finishedAt ?? null,
    createdAt: i.createdAt,
  };
}

const serializeItem = (it) => ({
  _id: it._id,
  index: it.index,
  rows: it.rows,
  handle: it.handle ?? null,
  name: it.name ?? null,
  sku: it.sku ?? null,
  status: it.status,
  issues: it.issues ?? [],
  product: it.product ?? null,
});

/* ─────────────── Images ─────────────── */

/** Reuses an image this vendor already has at that URL (e.g. from an export), otherwise downloads and stores it. */
async function resolveImage(url, actor, cache) {
  if (cache.has(url)) return cache.get(url);
  const promise = (async () => {
    const existing = await Media.findOne({ url, 'uploadedBy.kind': actor.kind, 'uploadedBy.id': actor.id }, '_id url').lean();
    if (existing) return { media: existing._id, url: existing.url };
    if (url.startsWith('/')) throw new Error('No image of yours at this path');
    const file = await downloadRemoteImage(url);
    const media = await storageService.uploadImage({ ...file, size: file.buffer.length }, { folder: 'products', uploadedBy: actor });
    return { media: media._id, url: media.url };
  })();
  cache.set(url, promise);
  return promise;
}

/** Resolves the item's image URLs; a broken link is reported but doesn't stop the product. */
async function resolveItemImages(item, actor) {
  const cache = new Map();
  const warnings = [];
  const attempt = async (url) => {
    try {
      return await resolveImage(url, actor, cache);
    } catch (err) {
      warnings.push({
        row: item.rows[0],
        column: 'image_urls',
        message: `Image skipped (${err.message.slice(0, 120)}): ${url.slice(0, 100)}`,
      });
      return null;
    }
  };
  const images = (await Promise.all(item.imageUrls.map(attempt))).filter(Boolean).map(({ media }) => ({ media: String(media) }));
  const variantImages = await Promise.all(item.variantImageUrls.map((u) => (u ? attempt(u) : null)));
  return { images, variantImages, warnings };
}

/* ─────────────── Processing ─────────────── */

/** Turns a product-service error into item issues the vendor can act on. */
function issuesFrom(err, item) {
  const details = Array.isArray(err.details) ? err.details : [];
  if (details.length)
    return details.slice(0, 10).map((d) => ({ row: item.rows[0], column: d.path, message: `${err.message}: ${d.message}` }));
  return [{ row: item.rows[0], message: err instanceof ApiError ? err.message : 'Unexpected error while saving this product' }];
}

async function processItem(imp, vendor, itemId) {
  const actor = { kind: 'vendor', id: vendor._id };
  const item = await ProductImportItem.findOneAndUpdate(
    { _id: itemId, status: { $in: ['pending', 'processing'] } },
    { $set: { status: 'processing' }, $inc: { attempts: 1 } },
    { returnDocument: 'after' },
  ).lean();
  if (!item) return;

  const finish = async (status, patch, counter) => {
    await ProductImportItem.updateOne({ _id: item._id }, { $set: { status, ...patch } });
    await ProductImport.updateOne({ _id: imp._id }, { $inc: { [`counts.${counter}`]: 1 } });
  };

  try {
    const existing = item.sku
      ? await Product.findOne({ vendor: vendor._id, sku: item.sku, status: { $ne: 'archived' } }, '_id createdAt').lean()
      : null;

    // Resuming after a crash: a product with this SKU created during this import is ours already.
    if (existing && imp.mode === 'create') {
      if (item.attempts > 1 && existing.createdAt >= imp.startedAt) return finish('created', { product: existing._id }, 'created');
      return finish(
        'failed',
        { issues: [{ row: item.rows[0], column: 'sku', message: 'A product with this SKU was added after the file was checked' }] },
        'failed',
      );
    }

    const { images, variantImages, warnings } = await resolveItemImages(item, actor);
    const input = structuredClone(item.input);
    if (images.length) input.images = images;
    if (input.variants) {
      input.variants = input.variants.map((v, i) => (variantImages[i] ? { ...v, image: { media: String(variantImages[i].media) } } : v));
    }

    if (existing) {
      // Same rules as the editor: content edits on a live product may go back to review.
      const { publish, ...changes } = input;
      await productService.vendorUpdate(vendor, existing._id, { ...changes, ...(publish ? { publish } : {}) });
      return finish('updated', { product: existing._id, issues: warnings }, 'updated');
    }
    const created = await productService.vendorCreate(vendor, input);
    return finish('created', { product: created._id, issues: warnings }, 'created');
  } catch (err) {
    const expected = err instanceof ApiError && err.statusCode < 500;
    if (!expected && item.attempts < MAX_ITEM_ATTEMPTS) {
      logger.warn({ err, importId: imp._id, itemId: item._id }, 'Import item failed; will retry');
      await ProductImportItem.updateOne({ _id: item._id }, { $set: { status: 'pending' } });
      return;
    }
    if (!expected) logger.error({ err, importId: imp._id, itemId: item._id }, 'Import item failed permanently');
    return finish('failed', { issues: issuesFrom(err, item) }, 'failed');
  }
}

/** Claims one import that needs work (queued, or processing with an expired lease). */
function claimImport() {
  const now = new Date();
  return ProductImport.findOneAndUpdate(
    {
      status: { $in: ['queued', 'processing'] },
      $or: [{ 'lease.until': { $exists: false } }, { 'lease.until': null }, { 'lease.until': { $lt: now } }],
    },
    { $set: { status: 'processing', lease: { owner: WORKER_ID, until: new Date(now.getTime() + LEASE_MS) } } },
    { sort: { createdAt: 1 }, returnDocument: 'after' },
  ).lean();
}

/* ─────────────── Workbooks ─────────────── */

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const TEXT_COLUMNS = ['sku', 'hsn_code', 'barcode', 'variant_sku', 'variant_barcode', 'handle'];
const YES_NO = ['track_quantity', 'available', 'low_stock_alert', 'publish', 'variant_available'];

async function usableCategories(vendorId) {
  const filter = vendorId ? { $or: [{ status: 'active' }, { owner: vendorId, status: { $ne: 'rejected' } }] } : { status: 'active' };
  const cats = await Category.find(filter, 'name slug ancestors level').lean();
  const byId = new Map(cats.map((c) => [String(c._id), c]));
  return (
    cats
      .map((c) => ({
        path: [...c.ancestors.map((a) => byId.get(String(a))?.name ?? '?'), c.name].join(' > '),
        slug: c.slug,
        level: c.level,
      }))
      // Deepest (most specific) first, then alphabetical: the best examples for the template.
      .sort((a, b) => b.level - a.level || a.path.localeCompare(b.path))
  );
}

/** Products sheet (with dropdowns and header notes), plus Instructions and Categories sheets. */
function productWorkbook(rows, categories) {
  const help = Object.fromEntries(COLUMNS.filter((c) => c.help).map((c) => [c.key, c.help]));
  const choices = Object.fromEntries(
    COLUMNS.filter((c) => /^One of: /.test(c.help ?? '')).map((c) => [
      c.key,
      c.help
        .replace(/^One of: /, '')
        .replace(/\..*$/, '')
        .split(/,\s*/),
    ]),
  );
  return toXlsx([
    {
      name: 'Products',
      rows: [COLUMN_KEYS.map((k) => (COLUMNS.find((c) => c.key === k).required ? `${k}*` : k)), ...rows],
      keys: COLUMN_KEYS,
      required: new Set(COLUMNS.filter((c) => c.required).map((c) => c.key)),
      notes: help,
      textColumns: TEXT_COLUMNS,
      freeze: true,
      widths: { name: 36, category: 32, short_description: 36, description: 40, image_urls: 48, specifications: 36 },
      lists: {
        ...choices,
        gst_rate: GST_RATES.map(String),
        ...Object.fromEntries(YES_NO.map((k) => [k, ['yes', 'no']])),
        ...(categories.length ? { category: `Categories!$A$2:$A$${categories.length + 1}` } : {}),
      },
    },
    {
      name: 'Instructions',
      rows: [
        ['column', 'required', 'how to fill it'],
        ...COLUMNS.map((c) => [c.key, c.required ? 'yes' : '', c.help ?? '']),
        [],
        [
          'Tips',
          '',
          'Keep the header row. One row per product; rows with the same handle are one product with variants. Prices are in rupees incl. GST.',
        ],
      ],
      widths: { column: 22, required: 10, 'how to fill it': 110 },
    },
    { name: 'Categories', rows: [['category', 'slug'], ...categories.map((c) => [c.path, c.slug])], widths: { category: 60, slug: 40 } },
  ]);
}

/* ─────────────── Public API ─────────────── */

export const productImportService = {
  /** Step 1: parse + validate. Stores the result; no products are touched. */
  async create(vendor, { buffer, originalname }, mode, createdBy = { kind: 'vendor', id: vendor._id }) {
    const active = await ProductImport.countDocuments({ vendor: vendor._id, status: { $in: ['queued', 'processing'] } });
    if (active >= MAX_ACTIVE_IMPORTS) {
      throw ApiError.tooManyRequests('You already have imports running. Wait for them to finish before uploading more.', {
        code: 'IMPORTS_BUSY',
      });
    }

    const parsed = await parseImportFile({ buffer, originalname }, { vendorId: vendor._id, mode });
    const valid = parsed.items.filter((i) => !i.issues.length);
    const imp = await ProductImport.create({
      vendor: vendor._id,
      createdBy,
      fileName: originalname?.slice(0, 255),
      mode,
      status: 'validated',
      counts: { rows: parsed.rowCount, items: parsed.items.length, valid: valid.length, invalid: parsed.items.length - valid.length },
      fileIssues: parsed.fileIssues.slice(0, MAX_STORED_ISSUES),
    });

    const docs = parsed.items.map((it) => ({
      import: imp._id,
      index: it.index,
      rows: it.rows,
      handle: it.handle,
      name: it.name?.slice(0, 200),
      sku: it.sku,
      status: it.issues.length ? 'invalid' : 'pending',
      input: it.issues.length ? undefined : it.input,
      imageUrls: it.imageUrls,
      variantImageUrls: it.variantImageUrls,
      issues: it.issues.slice(0, MAX_STORED_ISSUES),
    }));
    for (let i = 0; i < docs.length; i += 500) await ProductImportItem.insertMany(docs.slice(i, i + 500), { ordered: false });
    logger.info({ importId: imp._id, vendorId: vendor._id, items: docs.length, valid: valid.length }, 'Product import validated');
    return serializeImport(imp);
  },

  /** Step 2: vendor confirms; valid items are queued for the worker. */
  async start(scope, id) {
    const imp = await ProductImport.findOneAndUpdate(
      { _id: id, ...scope, status: 'validated', 'counts.valid': { $gt: 0 } },
      { $set: { status: 'queued', startedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!imp) {
      const current = await ProductImport.findOne({ _id: id, ...scope }).lean();
      if (!current) throw ApiError.notFound('Import not found');
      throw ApiError.conflict(current.counts.valid ? 'This import has already been started' : 'There are no valid products to import', {
        code: 'INVALID_IMPORT_STATE',
      });
    }
    // Start right away instead of waiting for the next worker tick (the lease prevents double work).
    if (!env.isTest) setImmediate(() => this.processQueued().catch((err) => logger.error({ err }, 'Import worker failed')));
    return serializeImport(imp);
  },

  async cancel(scope, id) {
    const imp = await ProductImport.findOneAndUpdate(
      { _id: id, ...scope, status: { $in: ['validated', 'queued', 'processing'] } },
      { $set: { status: 'cancelled', finishedAt: new Date() }, $unset: { lease: 1 } },
      { returnDocument: 'after' },
    );
    if (!imp) throw ApiError.conflict('This import can no longer be cancelled', { code: 'INVALID_IMPORT_STATE' });
    await ProductImportItem.updateMany({ import: imp._id, status: 'pending' }, { $set: { status: 'skipped' } });
    return serializeImport(imp);
  },

  async list(scope, { page, limit, vendor }) {
    const filter = { ...(vendor ? { vendor } : {}), ...scope };
    const [rows, total] = await Promise.all([
      ProductImport.find(filter)
        .populate('vendor', 'store.name')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ProductImport.countDocuments(filter),
    ]);
    return { items: rows.map(serializeImport), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async get(scope, id) {
    const imp = await ProductImport.findOne({ _id: id, ...scope })
      .populate('vendor', 'store.name')
      .lean();
    if (!imp) throw ApiError.notFound('Import not found');
    return serializeImport(imp);
  },

  async items(scope, id, { page, limit, status }) {
    const imp = await ProductImport.exists({ _id: id, ...scope });
    if (!imp) throw ApiError.notFound('Import not found');
    const filter = { import: id, ...(status ? { status: { $in: status === 'problems' ? ['invalid', 'failed'] : [status] } } : {}) };
    const [rows, total] = await Promise.all([
      ProductImportItem.find(filter, '-input')
        .sort({ index: 1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ProductImportItem.countDocuments(filter),
    ]);
    return { items: rows.map(serializeItem), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  /** Every problem (and image warning) as a CSV the vendor can fix rows from. */
  async issuesCsv(scope, id) {
    const imp = await ProductImport.findOne({ _id: id, ...scope }).lean();
    if (!imp) throw ApiError.notFound('Import not found');
    const rows = [['row', 'column', 'product', 'sku', 'status', 'problem']];
    for (const i of imp.fileIssues) rows.push([i.row ?? '', i.column ?? '', '', '', 'file', i.message]);
    const cursor = ProductImportItem.find({ import: id, 'issues.0': { $exists: true } }, 'name sku status issues')
      .sort({ index: 1 })
      .lean()
      .cursor();
    for await (const it of cursor)
      for (const i of it.issues) rows.push([i.row ?? '', i.column ?? '', it.name ?? '', it.sku ?? '', it.status, i.message]);
    return toCsv(rows);
  },

  /* ─────────────── Worker ─────────────── */

  /**
   * Processes queued imports until `budgetMs` runs out. Safe to run on every instance:
   * an import is only worked on by the holder of its lease, and items are claimed one by one.
   */
  async processQueued({ budgetMs = 8_000 } = {}) {
    const deadline = Date.now() + budgetMs;
    let processed = 0;
    while (Date.now() < deadline) {
      const imp = await claimImport();
      if (!imp) break;
      const vendor = await Vendor.findById(imp.vendor).lean();
      if (!vendor || vendor.status !== 'approved') {
        await ProductImport.updateOne(
          { _id: imp._id },
          { $set: { status: 'failed', error: 'Your store is not approved', finishedAt: new Date() }, $unset: { lease: 1 } },
        );
        continue;
      }

      let drained = false;
      while (Date.now() < deadline) {
        const current = await ProductImport.findOne({ _id: imp._id }, 'status lease').lean();
        if (current.status !== 'processing' || current.lease?.owner !== WORKER_ID) break; // cancelled or lease lost
        const batch = await ProductImportItem.find({ import: imp._id, status: { $in: ['pending', 'processing'] } }, '_id')
          .sort({ index: 1 })
          .limit(ITEM_CONCURRENCY)
          .lean();
        if (!batch.length) {
          drained = true;
          break;
        }
        await Promise.all(batch.map((b) => processItem(imp, vendor, b._id)));
        processed += batch.length;
        await ProductImport.updateOne(
          { _id: imp._id, 'lease.owner': WORKER_ID },
          { $set: { 'lease.until': new Date(Date.now() + LEASE_MS) } },
        );
      }

      if (drained) {
        const done = await ProductImport.findOneAndUpdate(
          { _id: imp._id, status: 'processing', 'lease.owner': WORKER_ID },
          { $set: { status: 'completed', finishedAt: new Date() }, $unset: { lease: 1 } },
          { returnDocument: 'after' },
        ).lean();
        if (done) logger.info({ importId: imp._id, counts: done.counts }, 'Product import completed');
      } else {
        // Out of time: hand the lease back so the next tick (any instance) continues.
        await ProductImport.updateOne({ _id: imp._id, 'lease.owner': WORKER_ID }, { $unset: { lease: 1 } });
      }
    }
    return processed;
  },

  /** Drops unconfirmed uploads after a week and finished ones after 90 days, with their items. */
  async purge(now = Date.now()) {
    const stale = await ProductImport.find(
      {
        $or: [
          { status: 'validated', createdAt: { $lt: new Date(now - 7 * 24 * 60 * 60_000) } },
          { status: { $in: ['completed', 'cancelled', 'failed'] }, createdAt: { $lt: new Date(now - 90 * 24 * 60 * 60_000) } },
        ],
      },
      '_id',
    )
      .limit(100)
      .lean();
    const ids = stale.map((s) => s._id);
    if (!ids.length) return 0;
    await ProductImportItem.deleteMany({ import: { $in: ids } });
    await ProductImport.deleteMany({ _id: { $in: ids } });
    return ids.length;
  },

  /* ─────────────── Files ─────────────── */

  /**
   * A template that uploads cleanly as downloaded: example rows use real categories the
   * vendor can list in, so they can edit the rows in place. Excel adds dropdowns and a guide.
   */
  async template({ vendorId, format }) {
    const cats = await usableCategories(vendorId);
    const [first, second] = [cats[0]?.path ?? 'Your category', (cats[1] ?? cats[0])?.path ?? 'Your category'];
    const blankRow = Object.fromEntries(COLUMN_KEYS.map((k) => [k, '']));
    const single = {
      ...blankRow,
      sku: 'SPR-16L',
      name: 'Knapsack Sprayer 16L',
      type: 'tool',
      category: first,
      brand: 'Kisan',
      condition: 'new',
      short_description: 'Manual sprayer with brass nozzle',
      mrp: 2499,
      price: 1999,
      gst_rate: 18,
      hsn_code: '8424',
      track_quantity: 'yes',
      stock: 25,
      available: 'yes',
      low_stock_alert: 'yes',
      low_stock_threshold: 5,
      unit: 'piece',
      moq: 1,
      weight_kg: 3.5,
      dispatch_days: 2,
      tags: 'sprayer, garden',
      specifications: 'Capacity: 16 L | Pump: Piston',
      publish: 'no',
    };
    const variant = {
      ...blankRow,
      handle: 'nitrile-gloves',
      sku: 'GLV-NIT',
      name: 'Nitrile Work Gloves',
      type: 'tool',
      category: second,
      gst_rate: 12,
      hsn_code: '4015',
      track_quantity: 'yes',
      unit: 'pair',
      publish: 'no',
      option1_name: 'Size',
      option1_value: 'M',
      variant_price: 199,
      variant_mrp: 249,
      variant_stock: 40,
      variant_available: 'yes',
    };
    const variant2 = {
      ...blankRow,
      handle: 'nitrile-gloves',
      option1_value: 'L',
      variant_price: 219,
      variant_mrp: 249,
      variant_stock: 30,
      variant_available: 'yes',
    };
    const rows = [single, variant, variant2].map((r) => COLUMN_KEYS.map((k) => r[k]));
    if (format === 'csv') return { body: toCsv([COLUMN_KEYS, ...rows]), type: 'text/csv; charset=utf-8', ext: 'csv' };
    return { body: await productWorkbook([...rows], cats), type: XLSX_TYPE, ext: 'xlsx' };
  },

  columns: () => COLUMNS.map(({ key, required, help, scope }) => ({ key, required: Boolean(required), help: help ?? '', scope })),

  /** Categories usable for the vendor (or every active one for admins without a vendor), as written in the sheet. */
  async categoriesCsv(vendorId) {
    const cats = await usableCategories(vendorId);
    return toCsv([['category', 'slug'], ...cats.map((c) => [c.path, c.slug])]);
  },

  /** Every product of a vendor in the template layout; edit and re-upload with "Update existing" to bulk edit. */
  async exportFile(vendorId, format) {
    const all = await Category.find({}, 'name ancestors').lean();
    const byId = new Map(all.map((c) => [String(c._id), c]));
    const pathName = (id) => {
      const c = byId.get(String(id));
      return c ? [...c.ancestors.map((a) => byId.get(String(a))?.name ?? '?'), c.name].join(' > ') : '';
    };
    const rows = [];
    const cursor = Product.find({ vendor: vendorId, status: { $ne: 'archived' } })
      .sort({ createdAt: 1 })
      .lean()
      .cursor();
    for await (const p of cursor) for (const row of productToRows(p, pathName(p.category))) rows.push(COLUMN_KEYS.map((k) => row[k] ?? ''));
    if (format === 'csv') return { body: toCsv([COLUMN_KEYS, ...rows]), type: 'text/csv; charset=utf-8', ext: 'csv' };
    return { body: await productWorkbook(rows, await usableCategories(vendorId)), type: XLSX_TYPE, ext: 'xlsx' };
  },
};
