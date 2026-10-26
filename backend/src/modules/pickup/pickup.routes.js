import { Router } from 'express';
import { z } from 'zod';
import { validate } from '#core/middlewares/validate.js';
import { ok } from '#core/utils/response.js';
import { addressSchema, indianPhone, nonEmpty, objectId, optionalText, pincode } from '#core/validation/common.js';
import { pickupService } from './pickup.service.js';

const warehouse = addressSchema.extend({
  _id: objectId.optional(),
  name: nonEmpty(80),
  phone: indianPhone.optional().or(z.literal('').transform(() => undefined)),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  mapUrl: z.url({ protocol: /^https?$/ }).max(500).optional().or(z.literal('').transform(() => undefined)),
  hours: optionalText(120),
  active: z.boolean().default(true),
});

const settingsBody = z.object({
  enabled: z.boolean(),
  includeMainAddress: z.boolean(),
  hours: optionalText(120),
  warehouses: z.array(warehouse).max(50),
});

/** Mounted at /vendor/pickup and /admin/store/pickup. */
export const sellerPickupRoutes = Router()
  .get('/', async (req, res) => ok(res, await pickupService.settings(req.auth.id)))
  .put('/', validate({ body: settingsBody }), async (req, res) => ok(res, await pickupService.save(req.auth.id, req.body)));

/** Mounted at /public/pickup-points: where the cart's sellers can be collected from, nearest first. */
export const publicPickupRoutes = Router().get(
  '/',
  validate({
    query: z.object({
      vendors: z
        .string()
        .max(25 * 25)
        .transform((v) => v.split(',').filter(Boolean).slice(0, 25)),
      pincode: pincode.optional(),
      city: z.string().trim().max(80).optional(),
      lat: z.coerce.number().min(-90).max(90).optional(),
      lng: z.coerce.number().min(-180).max(180).optional(),
    }),
  }),
  async (req, res) => {
    const { vendors, ...near } = req.query;
    ok(res, await pickupService.forVendors(vendors, near));
  },
);
