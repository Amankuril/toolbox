import { ApiError } from '#core/errors/ApiError.js';

/**
 * Admin-panel sections a staff member can be given access to, Shopify-staff style.
 * Each gets one level: none (hidden), view (read only) or manage (read + change).
 * The Admins section itself is never delegable: only super admins manage admins.
 */
export const ADMIN_SECTIONS = [
  { key: 'dashboard', label: 'Dashboard', help: 'Sales and order figures' },
  { key: 'orders', label: 'Orders & shipping', help: 'Orders, fulfilment, shipments, labels and returns' },
  { key: 'products', label: 'Products', help: 'Listings, moderation and bulk upload' },
  { key: 'vendors', label: 'Vendors', help: 'Seller applications, approvals and bank details' },
  { key: 'customers', label: 'Customers', help: 'Customer accounts and blocking' },
  { key: 'categories', label: 'Categories', help: 'Category tree and proposals' },
  { key: 'quotes', label: 'Bulk quotes', help: 'Quote requests between buyers and sellers' },
  { key: 'reviews', label: 'Reviews', help: 'Hide or publish product reviews' },
  { key: 'banners', label: 'Banners', help: 'Home page banners' },
  { key: 'media', label: 'Media library', help: 'Browse and delete uploaded files' },
  { key: 'settings', label: 'Settings', help: 'Theme, branding, payments, shipping, storage' },
];
export const SECTION_KEYS = ADMIN_SECTIONS.map((s) => s.key);
export const ACCESS_LEVELS = ['none', 'view', 'manage'];
const RANK = { none: 0, view: 1, manage: 2 };

/**
 * Access an admin has to a section. Super admins have everything; admins created before
 * permissions existed (no permissions stored) keep the full access they always had.
 */
export function accessOf(admin, section) {
  if (admin.role === 'super_admin' || !admin.permissions) return 'manage';
  return admin.permissions[section] ?? 'none';
}

export const hasFullAccess = (admin) => admin.role === 'super_admin' || !admin.permissions;

export function effectivePermissions(admin) {
  return Object.fromEntries(SECTION_KEYS.map((k) => [k, accessOf(admin, k)]));
}

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const labelOf = (key) => ADMIN_SECTIONS.find((s) => s.key === key)?.label ?? key;

/**
 * Guards an admin router: reads need view, everything else needs manage.
 * `readableBy` lets other sections read this one's lookups (e.g. the product bulk upload
 * lists vendors to pick from) without being able to change anything here; `readablePath`
 * limits that to specific paths (so a vendor lookup never exposes bank details).
 */
export function requireSection(section, { readableBy = [], readablePath, writeMethods } = {}) {
  return (req, _res, next) => {
    const admin = req.account;
    const read = READ_METHODS.has(req.method);
    if (writeMethods && !read && !writeMethods.includes(req.method)) return next();
    const need = read ? 'view' : 'manage';
    const level = accessOf(admin, section);
    if (RANK[level] >= RANK[need]) return next();
    const lookup = !readablePath || readablePath.test(req.path);
    if (read && lookup && readableBy.some((s) => RANK[accessOf(admin, s)] >= RANK.view)) return next();
    throw ApiError.forbidden(
      level === 'view' ? `You have view-only access to ${labelOf(section)}.` : `You don't have access to ${labelOf(section)}.`,
      { code: 'PERMISSION_DENIED', details: { section, need } },
    );
  };
}
