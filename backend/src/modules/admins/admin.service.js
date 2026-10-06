import argon2 from 'argon2';
import { ApiError } from '#core/errors/ApiError.js';
import { hashPassword } from '#modules/auth/auth.service.js';
import { sessionService } from '#modules/auth/session.service.js';
import { Admin } from './admin.model.js';
import { serializeAdmin } from './admin.serializer.js';

export const adminService = {
  async me(id) {
    const admin = await Admin.findById(id).lean();
    if (!admin) throw ApiError.notFound('Admin not found');
    return serializeAdmin(admin);
  },

  /** Signs out every other session; the caller issues a fresh one for the current device. */
  async changePassword(id, { currentPassword, newPassword }) {
    const admin = await Admin.findById(id).select('+passwordHash');
    if (!admin || !(await argon2.verify(admin.passwordHash, currentPassword))) {
      throw ApiError.unprocessable('Current password is incorrect', {
        details: [{ path: 'currentPassword', message: 'Incorrect password' }],
      });
    }
    admin.passwordHash = await hashPassword(newPassword);
    admin.passwordChangedAt = new Date();
    await admin.save();
    await sessionService.revokeAll(admin._id, 'admin', 'password_change');
  },

  async list() {
    const rows = await Admin.find().sort({ createdAt: 1 }).lean();
    return rows.map(serializeAdmin);
  },

  async create({ name, email, password, role, permissions }) {
    if (await Admin.exists({ email })) throw ApiError.conflict('An admin with this email already exists');
    // New staff start with only what they're given; super admins don't need a list.
    const admin = await Admin.create({
      name,
      email,
      role,
      permissions: role === 'super_admin' || permissions === null ? undefined : (permissions ?? {}),
      passwordHash: await hashPassword(password),
    });
    return serializeAdmin(admin.toObject());
  },

  async update(id, { name, role, status, password, permissions }, actor) {
    const admin = await Admin.findById(id);
    if (!admin) throw ApiError.notFound('Admin not found');

    const isSelf = String(admin._id) === String(actor.id);
    if (isSelf && ((role && role !== admin.role) || (status && status !== 'active'))) {
      throw ApiError.forbidden('You cannot change your own role or disable yourself');
    }
    if (admin.role === 'super_admin' && (role === 'admin' || status === 'disabled')) {
      const others = await Admin.countDocuments({ role: 'super_admin', status: 'active', _id: { $ne: admin._id } });
      if (others === 0) throw ApiError.conflict('At least one active super admin is required');
    }

    if (isSelf && permissions !== undefined) throw ApiError.forbidden('You cannot change your own permissions');

    if (name !== undefined) admin.name = name;
    if (permissions !== undefined) admin.permissions = permissions === null ? undefined : permissions;
    if (role !== undefined) admin.role = role;
    // Super admins have everything; a stored list would only mislead if they're demoted later.
    if (admin.role === 'super_admin') admin.permissions = undefined;
    if (status !== undefined) admin.status = status;
    if (password !== undefined) {
      admin.passwordHash = await hashPassword(password);
      admin.passwordChangedAt = new Date();
    }
    await admin.save();

    if (status === 'disabled' || password !== undefined) {
      await sessionService.revokeAll(admin._id, 'admin', password !== undefined ? 'password_change' : 'admin');
    }
    return serializeAdmin(admin.toObject());
  },
};
