export function serializeAdmin(admin) {
  if (!admin) return null;
  return {
    _id: admin._id,
    role: 'admin',
    adminRole: admin.role,
    name: admin.name,
    email: admin.email,
    status: admin.status,
    lastLoginAt: admin.lastLoginAt ?? null,
    createdAt: admin.createdAt,
  };
}
