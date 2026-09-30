import { Router } from 'express';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { actorOf, requireAdminRole } from '#modules/auth/auth.middleware.js';
import { sessionService } from '#modules/auth/session.service.js';
import { adminService } from './admin.service.js';
import { changePassword, createAdmin, updateAdmin } from './admin.validation.js';

/** Mounted at /admin — the signed-in admin's own account. */
export const adminSelfRoutes = Router()
  .get('/me', async (req, res) => ok(res, await adminService.me(req.auth.id)))
  .post('/me/password', validate(changePassword), async (req, res) => {
    await adminService.changePassword(req.auth.id, req.body);
    // Keep this device signed in with a fresh session; all others were revoked.
    await sessionService.start({ subject: req.auth.id, audience: 'admin', req, res });
    ok(res, { changed: true });
  });

/** Mounted at /admin/admins — super admins only. */
export const adminManagementRoutes = Router()
  .use(requireAdminRole('super_admin'))
  .get('/', async (_req, res) => ok(res, await adminService.list()))
  .post('/', validate(createAdmin), async (req, res) => created(res, await adminService.create(req.body)))
  .patch('/:id', validate(updateAdmin), async (req, res) => ok(res, await adminService.update(req.params.id, req.body, actorOf(req))));
