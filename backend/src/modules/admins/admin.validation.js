import { z } from 'zod';
import { email, idParams, nonEmpty } from '#core/validation/common.js';
import { ADMIN_ROLES, ADMIN_STATUSES } from './admin.model.js';

export const password = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number');

export const changePassword = {
  body: z
    .object({ currentPassword: z.string().min(1).max(200), newPassword: password })
    .refine((v) => v.currentPassword !== v.newPassword, { path: ['newPassword'], message: 'Choose a different password' }),
};

export const createAdmin = {
  body: z.object({ name: nonEmpty(120), email, password, role: z.enum(ADMIN_ROLES).default('admin') }),
};

export const updateAdmin = {
  params: idParams,
  body: z.object({ name: nonEmpty(120), role: z.enum(ADMIN_ROLES), status: z.enum(ADMIN_STATUSES), password }).partial(),
};
