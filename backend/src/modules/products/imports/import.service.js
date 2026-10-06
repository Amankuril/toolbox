import crypto from 'node:crypto';
import { stringify } from 'csv-stringify/sync';
import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Category } from '#modules/categories/category.model.js';
import { Media } from '#modules/media/media.model.js';
import { Vendor } from '#modules/vendors/vendor.model.js';
import { downloadRemoteImage } from '#services/storage/remoteImage.js';
import { storageService } from '#services/storage/storage.service.js';
import { Product } from '../product.model.js';
import { productService } from '../product.service.js';
import { COLUMNS, COLUMN_KEYS, productToRows } from './import.columns.js';
import { ProductImport, ProductImportItem } from './import.model.js';
import { parseImportFile } from './import.parser.js';

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

/* ─────────────── Public API ─────────────── */

export const productImportService = {
  /** Step 1: parse + validate. Stores the result; no products are touched. */
  async create(vendor, { buffer, originalname }, mode) {
    const active = await ProductImport.countDocuments({ vendor: vendor._id, status: { $in: ['queued', 'processing'] } });
    if (active >= MAX_ACTIVE_IMPORTS) {
      throw ApiError.tooManyRequests('You already have imports running. Wait for them to finish before uploading more.', {
        code: 'IMPORTS_BUSY',
      });
    }

    const parsed = await parseImportFile(buffer, { vendorId: vendor._id, mode });
    const valid = parsed.items.filter((i) => !i.issues.length);
    const imp = await ProductImport.create({
      vendor: vendor._id,
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
  async start(vendor, id) {
    const imp = await ProductImport.findOneAndUpdate(
      { _id: id, vendor: vendor._id, status: 'validated', 'counts.valid': { $gt: 0 } },
      { $set: { status: 'queued', startedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!imp) {
      const current = await ProductImport.findOne({ _id: id, vendor: vendor._id }).lean();
      if (!current) throw ApiError.notFound('Import not found');
      throw ApiError.conflict(current.counts.valid ? 'This import has already been started' : 'There are no valid products to import', {
        code: 'INVALID_IMPORT_STATE',
      });
    }
    // Start right away instead of waiting for the next worker tick (the lease prevents double work).
    if (!env.isTest) setImmediate(() => this.processQueued().catch((err) => logger.error({ err }, 'Import worker failed')));
    return serializeImport(imp);
  },

  async cancel(vendor, id) {
    const imp = await ProductImport.findOneAndUpdate(
      { _id: id, vendor: vendor._id, status: { $in: ['validated', 'queued', 'processing'] } },
      { $set: { status: 'cancelled', finishedAt: new Date() }, $unset: { lease: 1 } },
      { returnDocument: 'after' },
    );
    if (!imp) throw ApiError.conflict('This import can no longer be cancelled', { code: 'INVALID_IMPORT_STATE' });
    await ProductImportItem.updateMany({ import: imp._id, status: 'pending' }, { $set: { status: 'skipped' } });
    return serializeImport(imp);
  },

  async list(vendor, { page, limit }) {
    const filter = { vendor: vendor._id };
    const [rows, total] = await Promise.all([
      ProductImport.find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      ProductImport.countDocuments(filter),
    ]);
    return { items: rows.map(serializeImport), meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
  },

  async get(vendor, id) {
    const imp = await ProductImport.findOne({ _id: id, vendor: vendor._id }).lean();
    if (!imp) throw ApiError.notFound('Import not found');
    return serializeImport(imp);
  },

  async items(vendor, id, { page, limit, status }) {
    const imp = await ProductImport.exists({ _id: id, vendor: vendor._id });
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
  async issuesCsv(vendor, id) {
    const imp = await ProductImport.findOne({ _id: id, vendor: vendor._id }).lean();
    if (!imp) throw ApiError.notFound('Import not found');
    const rows = [['row', 'column', 'product', 'sku', 'status', 'problem']];
    for (const i of imp.fileIssues) rows.push([i.row ?? '', i.column ?? '', '', '', 'file', i.message]);
    const cursor = ProductImportItem.find({ import: id, 'issues.0': { $exists: true } }, 'name sku status issues')
      .sort({ index: 1 })
      .lean()
      .cursor();
    for await (const it of cursor)
      for (const i of it.issues) rows.push([i.row ?? '', i.column ?? '', it.name ?? '', it.sku ?? '', it.status, i.message]);
    return stringify(rows, { bom: true });
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

  /** Header row + a single product + a two-variant product. */
  template() {
    const example = Object.fromEntries(COLUMNS.map((c) => [c.key, c.example ?? '']));
    const single = {
      ...example,
      handle: '',
      sku: 'SPR-16L',
      name: 'Knapsack Sprayer 16L',
      category: 'Sprayers',
      mrp: '2499',
      price: '1999',
      hsn_code: '8424',
      stock: '25',
      unit: 'piece',
      image_urls: 'https://example.com/sprayer.jpg',
      option1_name: '',
      option1_value: '',
      option2_name: '',
      option2_value: '',
      variant_price: '',
      variant_mrp: '',
      variant_stock: '',
      variant_available: '',
    };
    const variantSecond = {
      handle: example.handle,
      option1_value: 'L',
      option2_value: 'Black',
      variant_price: '429',
      variant_mrp: '499',
      variant_stock: '30',
      variant_available: 'yes',
    };
    return stringify(
      [
        COLUMN_KEYS,
        COLUMN_KEYS.map((k) => single[k] ?? ''),
        COLUMN_KEYS.map((k) => example[k] ?? ''),
        COLUMN_KEYS.map((k) => variantSecond[k] ?? ''),
      ],
      { bom: true },
    );
  },

  columns: () => COLUMNS.map(({ key, required, help, scope }) => ({ key, required: Boolean(required), help: help ?? '', scope })),

  /** Categories the vendor can use, as written in the sheet. */
  async categoriesCsv(vendor) {
    const cats = await Category.find(
      { $or: [{ status: 'active' }, { owner: vendor._id, status: { $ne: 'rejected' } }] },
      'name slug ancestors level',
    ).lean();
    const byId = new Map(cats.map((c) => [String(c._id), c]));
    const rows = cats
      .map((c) => [[...c.ancestors.map((a) => byId.get(String(a))?.name ?? '?'), c.name].join(' > '), c.slug])
      .sort((a, b) => a[0].localeCompare(b[0]));
    return stringify([['category', 'slug'], ...rows], { bom: true });
  },

  /** Every product in the template layout; edit and re-upload with "Update existing" to bulk edit. */
  async exportCsv(vendor) {
    const cats = await Category.find({}, 'name ancestors').lean();
    const byId = new Map(cats.map((c) => [String(c._id), c]));
    const pathName = (id) => {
      const c = byId.get(String(id));
      return c ? [...c.ancestors.map((a) => byId.get(String(a))?.name ?? '?'), c.name].join(' > ') : '';
    };
    const lines = [COLUMN_KEYS];
    const cursor = Product.find({ vendor: vendor._id, status: { $ne: 'archived' } })
      .sort({ createdAt: 1 })
      .lean()
      .cursor();
    for await (const p of cursor)
      for (const row of productToRows(p, pathName(p.category))) lines.push(COLUMN_KEYS.map((k) => row[k] ?? ''));
    return stringify(lines, { bom: true });
  },
};
