import { z } from 'zod'

/** Client-side mirrors of the API rules, for instant feedback. The API remains the authority. */
export const phone10 = z
  .string()
  .trim()
  .transform((v) => v.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, ''))
  .refine((v) => /^[6-9]\d{9}$/.test(v), 'Enter a valid 10 digit mobile number')

export const email = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email'))
export const optionalEmail = z.union([z.literal(''), email]).optional()

export const gstin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15 character GSTIN')
export const optionalGstin = z.union([z.literal(''), gstin]).optional()

export const pan = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{5}\d{4}[A-Z]$/, 'Enter a valid PAN')

export const ifsc = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Enter a valid IFSC code')

export const pincode = z
  .string()
  .trim()
  .regex(/^[1-9]\d{5}$/, 'Enter a valid 6 digit pincode')

export const required = (label = 'This field', max = 200) => z.string().trim().min(1, `${label} is required`).max(max)

export const addressFields = {
  line1: required('Address', 200),
  line2: z.string().trim().max(200).optional(),
  landmark: z.string().trim().max(120).optional(),
  city: required('City', 80),
  state: required('State', 80),
  pincode,
}

/** Mirrors the API admin password policy. */
export const passwordRule = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Include at least one letter and one number')
