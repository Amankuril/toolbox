import { z } from 'zod';
import { paginationQuery } from '#core/utils/pagination.js';
import { addressSchema, email, gstin, idParams, indianPhone, nonEmpty, objectId, optionalText } from '#core/validation/common.js';
import { ACCOUNT_TYPES, USER_STATUSES } from './user.model.js';

export const MAX_ADDRESSES = 10;

export const updateMe = {
  body: z
    .object({
      name: nonEmpty(120),
      email: email.nullable(),
      accountType: z.enum(ACCOUNT_TYPES),
      businessName: optionalText(200),
      gstin: gstin.nullable(),
    })
    .partial(),
};

const addressBody = addressSchema.extend({
  label: z.string().trim().max(40).default('Home'),
  name: nonEmpty(120),
  phone: indianPhone,
  isDefault: z.boolean().optional(),
});

export const createAddress = { body: addressBody };
export const updateAddress = {
  params: z.object({ addressId: objectId }),
  body: addressBody.partial(),
};
export const addressParams = { params: z.object({ addressId: objectId }) };

export const adminListUsers = {
  query: z.object({
    ...paginationQuery,
    status: z.enum(USER_STATUSES).optional(),
    q: z.string().trim().max(100).optional(),
  }),
};

export const adminSetUserStatus = {
  params: idParams,
  body: z.object({ status: z.enum(USER_STATUSES) }),
};
