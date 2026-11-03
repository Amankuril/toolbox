import { Router } from 'express';
import multer from 'multer';
import { env } from '#config/env.js';
import { ApiError } from '#core/errors/ApiError.js';
import { rateLimit } from '#core/middlewares/rateLimit.js';
import { ok } from '#core/utils/response.js';
import { categoryService } from '#modules/categories/category.service.js';
import { productService } from '#modules/products/product.service.js';
import { visionService } from '#services/vision/vision.service.js';

const photo = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.UPLOAD_MAX_FILE_SIZE_MB * 1024 * 1024, files: 1, fields: 2, parts: 3 },
  fileFilter(_req, file, cb) {
    if (!file.mimetype?.startsWith('image/')) return cb(ApiError.badRequest('Choose a photo (JPEG, PNG or WebP)', { code: 'UNSUPPORTED_FILE' }));
    cb(null, true);
  },
}).single('file');

/** Every category as "Parent > Child" so the model can pick the most specific one. */
function flatten(nodes, trail = [], out = []) {
  for (const n of nodes) {
    const path = [...trail, n.name];
    out.push({ id: String(n._id), slug: n.slug, path: path.join(' > ') });
    flatten(n.children ?? [], path, out);
  }
  return out;
}

const count = async (params) => (await productService.publicList({ page: 1, limit: 1, ...params })).meta.total;

/**
 * Picks the narrowest search that still finds something: the words in the category, then the words
 * anywhere, then the category on its own.
 */
async function bestSearch(id, category) {
  const words = [...new Set([id.brand, id.modelNumber, id.productType, ...(id.keywords ?? [])].map((w) => w?.trim()).filter(Boolean))];
  const q = words.join(' ').slice(0, 200);
  const attempts = [
    q && category && { q, category: category.slug },
    q && { q },
    category && { category: category.slug },
  ].filter(Boolean);
  for (const a of attempts) {
    const total = await count(a);
    if (total) return { ...a, total };
  }
  return { q, total: 0 };
}

/** POST /public/image-search  (multipart "file") → what's in the photo and the search that finds it. */
export const publicImageSearchRoutes = Router().post(
  '/',
  (req, _res, next) => (visionService.enabled ? next() : next(ApiError.notFound('Search by image is not available', { code: 'IMAGE_SEARCH_OFF' }))),
  rateLimit({ keyPrefix: 'image-search', points: env.IMAGE_SEARCH_PER_HOUR, duration: 3600 }),
  photo,
  async (req, res) => {
    if (!req.file) throw ApiError.badRequest('Attach a photo in the "file" field', { code: 'NO_FILES' });
    const categories = flatten(await categoryService.tree());
    let id;
    try {
      id = await visionService.identify(req.file.buffer, categories);
    } catch (err) {
      // sharp failing to decode = a bad file; anything else = the vision API (down, rate-limited, timed out).
      if (/unsupported image format|Input buffer|corrupt/i.test(err?.message ?? '')) {
        throw ApiError.unprocessable('That file could not be read as a photo', { code: 'BAD_IMAGE' });
      }
      req.log?.warn({ err }, 'image search failed');
      throw ApiError.serviceUnavailable('Search by image is busy right now. Please try again, or type what you are looking for.', {
        code: 'IMAGE_SEARCH_UNAVAILABLE',
      });
    }
    if (!id?.recognised) {
      return ok(res, { recognised: false, label: null, search: null });
    }
    const category = categories.find((c) => c.id === id.categoryId) ?? null;
    const search = await bestSearch(id, category);
    ok(res, {
      recognised: true,
      label: [id.brand, id.productType].filter(Boolean).join(' ') || id.productType,
      modelNumber: id.modelNumber || null,
      category: category && { slug: category.slug, path: category.path },
      search,
    });
  },
);
