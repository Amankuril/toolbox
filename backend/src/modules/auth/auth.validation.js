import { z } from 'zod';
import { email, gstin, indianPhone, nonEmpty } from '#core/validation/common.js';
import { ACCOUNT_TYPES } from '#modules/users/user.model.js';
import { AUDIENCES, OTP_AUDIENCES } from './auth.constants.js';

const otpAudience = z.enum(OTP_AUDIENCES);

export const sendOtpSchema = {
  body: z.object({ phone: indianPhone, audience: otpAudience }),
};

export const verifyOtpSchema = {
  body: z.object({
    phone: indianPhone,
    audience: otpAudience,
    otp: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/, 'Enter the code sent to your phone'),
  }),
};

export const registerUserSchema = {
  body: z
    .object({
      onboardingToken: z.string().min(10),
      name: nonEmpty(120),
      email: email.optional().or(z.literal('').transform(() => undefined)),
      accountType: z.enum(ACCOUNT_TYPES).default('individual'),
      businessName: z.string().trim().max(200).optional(),
      gstin: gstin.optional().or(z.literal('').transform(() => undefined)),
    })
    .superRefine((v, ctx) => {
      if (v.accountType === 'business' && !v.businessName) {
        ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'Business name is required' });
      }
    }),
};

export const registerVendorSchema = {
  body: z.object({
    onboardingToken: z.string().min(10),
    contactName: nonEmpty(120),
    email,
    storeName: nonEmpty(120),
  }),
};

export const adminLoginSchema = {
  body: z.object({
    email,
    password: z.string().min(1, 'Password is required').max(200),
  }),
};

export const audienceParams = {
  params: z.object({ audience: z.enum(AUDIENCES) }),
};
