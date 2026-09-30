/**
 * Creates (or resets) a super admin.
 *   ADMIN_EMAIL=you@company.com ADMIN_PASSWORD='...' ADMIN_NAME='You' npm run seed:admin
 * Omit ADMIN_PASSWORD to have a strong one generated and printed once.
 */
import crypto from 'node:crypto';
import { connectDatabase, disconnectDatabase } from '#config/db.js';
import { Admin } from '#modules/admins/admin.model.js';
import { password as passwordSchema } from '#modules/admins/admin.validation.js';
import { hashPassword } from '#modules/auth/auth.service.js';

const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
const name = process.env.ADMIN_NAME?.trim() || 'Super Admin';
const generated = !process.env.ADMIN_PASSWORD;
const password = process.env.ADMIN_PASSWORD || `${crypto.randomBytes(12).toString('base64url')}9a`;

if (!email) {
  console.error('ADMIN_EMAIL is required');
  process.exit(1);
}
const check = passwordSchema.safeParse(password);
if (!check.success) {
  console.error(`ADMIN_PASSWORD rejected: ${check.error.issues[0].message}`);
  process.exit(1);
}

await connectDatabase();
const passwordHash = await hashPassword(password);
const existing = await Admin.findOne({ email });

if (existing) {
  existing.passwordHash = passwordHash;
  existing.role = 'super_admin';
  existing.status = 'active';
  existing.passwordChangedAt = new Date();
  await existing.save();
  console.log(`Updated super admin ${email}`);
} else {
  await Admin.create({ name, email, passwordHash, role: 'super_admin' });
  console.log(`Created super admin ${email}`);
}
if (generated) console.log(`Generated password (shown once): ${password}`);

await disconnectDatabase();
process.exit(0);
