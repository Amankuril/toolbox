import mongoose from 'mongoose';
import { z } from 'zod';

export const objectId = z
  .string()
  .trim()
  .refine((v) => mongoose.isValidObjectId(v) && /^[0-9a-f]{24}$/i.test(v), 'Invalid id');

export const idParams = z.object({ id: objectId });

/** Indian mobile number. Accepts 10 digits with optional +91 / 91 / 0 prefix and normalises to E.164. */
export const indianPhone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ''))
  .transform((v) => v.replace(/^(\+91|91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10 digit mobile number')
  .transform((v) => `+91${v}`);

export const email = z.string().trim().toLowerCase().max(254).pipe(z.email('Enter a valid email address'));

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15 character GSTIN');

export const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN');

export const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code');

export const pincode = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a valid 6 digit pincode');

export const hexColor = z
  .string()
  .trim()
  .regex(/^#([0-9a-f]{6})$/i, 'Use a 6 digit hex colour like #1f2937')
  .transform((v) => v.toLowerCase());

export const nonEmpty = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const optionalText = (max = 2000) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v === '' ? undefined : v));

/** Query-string boolean: "true"/"false"/"1"/"0". */
export const queryBool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1')
  .optional();

/**
 * Image reference sent by clients. Only the media id is trusted; the URL is always
 * resolved server-side from the Media record (see mediaService.resolve).
 */
export const imageInput = z.object({
  media: objectId,
  alt: z.string().trim().max(200).optional(),
});

/** Image reference as stored (after server-side resolution). */
export const imageRef = imageInput.extend({ url: z.string().min(1).max(1000) });

export const addressSchema = z.object({
  line1: nonEmpty(200),
  line2: optionalText(200),
  landmark: optionalText(120),
  city: nonEmpty(80),
  state: nonEmpty(80),
  pincode,
});
