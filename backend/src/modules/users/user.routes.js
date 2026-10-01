import { Router } from 'express';
import { validate } from '#core/middlewares/validate.js';
import { created, ok } from '#core/utils/response.js';
import { idParams } from '#core/validation/common.js';
import { userService } from './user.service.js';
import { addressParams, adminListUsers, adminSetUserStatus, createAddress, updateAddress, updateMe } from './user.validation.js';

/** Mounted at /user (the signed-in customer). */
export const userSelfRoutes = Router()
  .get('/me', async (req, res) => ok(res, await userService.me(req.auth.id)))
  .patch('/me', validate(updateMe), async (req, res) => ok(res, await userService.updateMe(req.auth.id, req.body)))
  .get('/addresses', async (req, res) => ok(res, await userService.addresses(req.auth.id)))
  .post('/addresses', validate(createAddress), async (req, res) => created(res, await userService.addAddress(req.auth.id, req.body)))
  .patch('/addresses/:addressId', validate(updateAddress), async (req, res) =>
    ok(res, await userService.updateAddress(req.auth.id, req.params.addressId, req.body)),
  )
  .delete('/addresses/:addressId', validate(addressParams), async (req, res) =>
    ok(res, await userService.removeAddress(req.auth.id, req.params.addressId)),
  );

export const adminUserRoutes = Router()
  .get('/', validate(adminListUsers), async (req, res) => {
    const { items, meta } = await userService.adminList(req.query);
    ok(res, items, meta);
  })
  .get('/:id', validate({ params: idParams }), async (req, res) => ok(res, await userService.adminGet(req.params.id)))
  .patch('/:id/status', validate(adminSetUserStatus), async (req, res) =>
    ok(res, await userService.adminSetStatus(req.params.id, req.body.status)),
  );
