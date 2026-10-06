import { effectivePermissions, hasFullAccess } from './permissions.js';

export function serializeAdmin(admin) {
  if (!admin) return null;
  return {
    _id: admin._id,
    role: 'admin',
    adminRole: admin.role,
    name: admin.name,
    email: admin.email,
    status: admin.status,
    // What this admin can actually do, per section; fullAccess = super admin or a legacy admin.
    permissions: effectivePermissions(admin),
    fullAccess: hasFullAccess(admin),
    lastLoginAt: admin.lastLoginAt ?? null,
    createdAt: admin.createdAt,
  };
}
