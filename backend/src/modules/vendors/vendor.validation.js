import { z } from 'zod';
import { paginationQuery } from '#core/utils/pagination.js';
import {
  addressSchema,
  email,
  gstin,
  idParams,
  ifsc,
  imageInput,
  indianPhone,
  nonEmpty,
  objectId,
  optionalText,
  pan,
} from '#core/validation/common.js';
import { BUSINESS_TYPES, VENDOR_DOCUMENT_TYPES, VENDOR_STATUSES } from './vendor.model.js';

export const REQUIRED_DOCUMENTS = ['gst_certificate', 'cancelled_cheque'];

export const businessStep = {
  body: z
    .object({
      legalName: nonEmpty(200),
      type: z.enum(BUSINESS_TYPES),
      gstin,
      pan,
      yearEstablished: z.number().int().min(1900).max(new Date().getFullYear()).optional(),
      storeName: nonEmpty(120).optional(),
      storeDescription: optionalText(2000),
    })
    // A GSTIN embeds the business PAN at positions 3-12.
    .refine((v) => v.gstin.slice(2, 12) === v.pan, { path: ['pan'], message: 'PAN does not match the GSTIN' }),
};

export const addressStep = { body: addressSchema };

export const bankStep = {
  body: z
    .object({
      accountHolderName: nonEmpty(120),
      accountNumber: z
        .string()
        .trim()
        .regex(/^\d{9,18}$/, 'Account number must be 9 to 18 digits'),
      confirmAccountNumber: z.string().trim(),
      ifsc,
      bankName: nonEmpty(120),
      branch: optionalText(120),
    })
    .refine((v) => v.accountNumber === v.confirmAccountNumber, { path: ['confirmAccountNumber'], message: 'Account numbers do not match' }),
};

export const documentsStep = {
  body: z
    .object({
      documents: z
        .array(z.object({ type: z.enum(VENDOR_DOCUMENT_TYPES), media: objectId }))
        .min(1)
        .max(10),
    })
    .superRefine((v, ctx) => {
      for (const required of REQUIRED_DOCUMENTS) {
        if (!v.documents.some((d) => d.type === required)) {
          ctx.addIssue({ code: 'custom', path: ['documents'], message: `${required.replace('_', ' ')} is required` });
        }
      }
    }),
};

export const updateProfile = {
  body: z
    .object({
      contactName: nonEmpty(120),
      email,
      storeName: nonEmpty(120),
      storeDescription: optionalText(2000),
      logo: imageInput.nullable(),
      // '' clears it (chats then go to the seller's mobile).
      whatsapp: indianPhone.or(z.literal('')),
    })
    .partial(),
};

export const adminListVendors = {
  query: z.object({
    ...paginationQuery,
    status: z.enum(VENDOR_STATUSES).optional(),
    q: z.string().trim().max(100).optional(),
  }),
};

export const adminReviewVendor = {
  params: idParams,
  body: z
    .object({ action: z.enum(['approve', 'reject']), note: optionalText(1000) })
    .refine((v) => v.action === 'approve' || v.note, { path: ['note'], message: 'Tell the vendor what needs to change' }),
};

export const adminSuspendVendor = {
  params: idParams,
  body: z.object({ note: nonEmpty(1000) }),
};

export const storeSlugParams = { params: z.object({ slug: z.string().trim().min(1).max(120) }) };
