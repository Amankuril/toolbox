import { z } from 'zod';

export const MAX_PAGE_SIZE = 100;

export const paginationQuery = {
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
};

/**
 * Runs a paginated find + count in parallel.
 * @returns {{ items: any[], meta: { page: number, limit: number, total: number, totalPages: number } }}
 */
export async function paginate(model, filter, { page = 1, limit = 20, sort = { createdAt: -1 }, select, populate, lean = true } = {}) {
  let query = model
    .find(filter)
    .sort(sort)
    .skip((page - 1) * limit)
    .limit(limit);
  if (select) query = query.select(select);
  if (populate) query = query.populate(populate);
  if (lean) query = query.lean();

  const [items, total] = await Promise.all([query.exec(), model.countDocuments(filter)]);
  return { items, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}
