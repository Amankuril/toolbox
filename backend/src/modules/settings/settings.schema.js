import { z } from 'zod';
import { hexColor, imageRef } from '#core/validation/common.js';

export const THEME_MODULES = ['user', 'vendor', 'admin'];
export const RADIUS_SCALE = ['none', 'sm', 'md', 'lg', 'xl'];

const moduleTheme = z.object({
  primary: hexColor,
  secondary: hexColor,
  accent: hexColor,
  radius: z.enum(RADIUS_SCALE),
});

/**
 * Every admin-editable setting group, with its schema and default.
 * Secrets (API keys) never live here; they stay in the environment.
 */
export const SETTINGS = {
  branding: {
    schema: z.object({
      siteName: z.string().trim().min(1).max(60),
      tagline: z.string().trim().max(160),
      logo: imageRef.nullable(),
      favicon: imageRef.nullable(),
      supportEmail: z.union([z.literal(''), z.email()]),
      supportPhone: z.string().trim().max(20),
    }),
    defaults: {
      siteName: 'Toolbox',
      tagline: 'Tools, machinery & spare parts for every trade',
      logo: null,
      favicon: null,
      supportEmail: '',
      supportPhone: '',
    },
  },

  theme: {
    schema: z.object({ user: moduleTheme, vendor: moduleTheme, admin: moduleTheme }),
    defaults: {
      user: { primary: '#e8590c', secondary: '#1b2a41', accent: '#0f9d58', radius: 'md' },
      vendor: { primary: '#2563eb', secondary: '#0f172a', accent: '#f59e0b', radius: 'md' },
      admin: { primary: '#4f46e5', secondary: '#111827', accent: '#10b981', radius: 'md' },
    },
  },

  storage: {
    schema: z.object({
      // ON → Cloudinary, OFF → local disk (nginx-served in production).
      cloudinaryEnabled: z.boolean(),
    }),
    defaults: { cloudinaryEnabled: false },
  },

  payments: {
    schema: z.object({
      razorpayEnabled: z.boolean(),
      codEnabled: z.boolean(),
      /** Orders above this value (paise) cannot use cash on delivery. 0 = no limit. */
      codMaxOrderValue: z.number().int().min(0),
    }),
    defaults: { razorpayEnabled: false, codEnabled: true, codMaxOrderValue: 0 },
  },

  shipping: {
    schema: z.object({
      /** Flat shipping fee per order in paise. */
      flatFee: z.number().int().min(0),
      /** Orders at or above this subtotal (paise) ship free. 0 = never free unless flatFee is 0. */
      freeAbove: z.number().int().min(0),
    }),
    defaults: { flatFee: 0, freeAbove: 0 },
  },

  moderation: {
    schema: z.object({
      autoApproveVendors: z.boolean(),
      autoApproveCategories: z.boolean(),
      autoApproveProducts: z.boolean(),
    }),
    defaults: { autoApproveVendors: false, autoApproveCategories: false, autoApproveProducts: false },
  },
};

export const SETTING_KEYS = Object.keys(SETTINGS);
