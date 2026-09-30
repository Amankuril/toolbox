import crypto from 'node:crypto';

export function slugify(input) {
  return String(input)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Generates a unique slug for `model` by appending a short random suffix on collision. */
export async function uniqueSlug(model, source, { field = 'slug', excludeId } = {}) {
  const base = slugify(source) || 'item';
  let candidate = base;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const filter = { [field]: candidate };
    if (excludeId) filter._id = { $ne: excludeId };
    const exists = await model.exists(filter);
    if (!exists) return candidate;
    candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`;
  }
  return `${base}-${Date.now().toString(36)}`;
}

export function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function maskTail(value, visible = 4) {
  if (!value) return value;
  const str = String(value);
  return `${'•'.repeat(Math.max(0, str.length - visible))}${str.slice(-visible)}`;
}
