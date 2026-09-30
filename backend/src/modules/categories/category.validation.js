import { z } from 'zod';
import { paginationQuery } from '#core/utils/pagination.js';
import { idParams, imageInput, nonEmpty, objectId, optionalText } from '#core/validation/common.js';
import { CATEGORY_STATUSES } from './category.model.js';

const base = {
  name: nonEmpty(120),
  description: optionalText(2000),
  image: imageInput.nullable().optional(),
  parent: objectId.nullable().optional(),
};

const adminOnly = {
  sortOrder: z.number().int().min(-10000).max(10000).optional(),
  isFeatured: z.boolean().optional(),
  status: z.enum(CATEGORY_STATUSES).optional(),
  seo: z.object({ title: optionalText(160), description: optionalText(320) }).optional(),
};

export const vendorCreateCategory = { body: z.object(base) };
export const vendorUpdateCategory = { params: idParams, body: z.object(base).partial() };

export const adminCreateCategory = { body: z.object({ ...base, ...adminOnly }) };
export const adminUpdateCategory = { params: idParams, body: z.object({ ...base, ...adminOnly }).partial() };

export const reviewCategory = {
  params: idParams,
  body: z
    .object({ action: z.enum(['approve', 'reject']), note: optionalText(500) })
    .refine((v) => v.action === 'approve' || v.note, { path: ['note'], message: 'Tell the vendor why it was rejected' }),
};

export const adminListCategories = {
  query: z.object({
    ...paginationQuery,
    limit: z.coerce.number().int().min(1).max(500).default(50),
    q: z.string().trim().max(100).optional(),
    status: z.enum(CATEGORY_STATUSES).optional(),
    source: z.enum(['platform', 'vendor']).optional(),
    parent: z.union([objectId, z.literal('root')]).optional(),
  }),
};

export const slugParams = { params: z.object({ slug: z.string().trim().min(1).max(120) }) };
