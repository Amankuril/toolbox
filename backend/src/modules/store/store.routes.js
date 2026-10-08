import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { addressSchema, email, gstin, imageInput, indianPhone, nonEmpty, optionalText } from '#core/validation/common.js';
import { storeService } from './store.service.js';

const updateStore = {
  body: z
    .object({
      storeName: nonEmpty(120),
      storeDescription: optionalText(2000),
      logo: imageInput.nullable(),
      contactName: nonEmpty(120),
      phone: indianPhone,
      email,
      address: addressSchema,
      gstin: gstin.or(z.literal('')),
      legalName: optionalText(200),
      whatsapp: indianPhone.or(z.literal('')),
    })
    .partial(),
};

/** Mounted at /admin/store (after actAsStore): the store's own settings. */
export const storeSettingsRoutes = Router()
  .get('/me', async (_req, res) => ok(res, await storeService.get()))
  .patch('/me', validate(updateStore), async (req, res) => ok(res, await storeService.update(req.body)));
