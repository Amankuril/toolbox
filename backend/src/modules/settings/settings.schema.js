import { z } from 'zod';
import { hexColor, imageRef } from '#core/validation/common.js';

export const THEME_MODULES = ['user', 'vendor', 'admin'];
export const RADIUS_SCALE = ['none', 'sm', 'md', 'lg', 'xl'];

const moduleBrand = z.object({ logo: imageRef.nullable(), favicon: imageRef.nullable() });

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
      supportEmail: z.union([z.literal(''), z.email()]),
      supportPhone: z.string().trim().max(20),
      // Each module (storefront, seller panel, admin panel) has its own logo and browser-tab icon.
      modules: z.object({ user: moduleBrand, vendor: moduleBrand, admin: moduleBrand }),
    }),
    defaults: {
      siteName: 'ToolsHubs',
      tagline: 'Tools for a greener tomorrow',
      supportEmail: '',
      supportPhone: '',
      modules: {
        user: { logo: null, favicon: null },
        vendor: { logo: null, favicon: null },
        admin: { logo: null, favicon: null },
      },
    },
  },

  theme: {
    schema: z.object({ user: moduleTheme, vendor: moduleTheme, admin: moduleTheme }),
    defaults: {
      user: { primary: '#15803d', secondary: '#0f291e', accent: '#f59e0b', radius: 'md' },
      vendor: { primary: '#15803d', secondary: '#0d2319', accent: '#f59e0b', radius: 'md' },
      admin: { primary: '#15803d', secondary: '#081a12', accent: '#f59e0b', radius: 'md' },
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
      /** Book shipments with Shipmozo. Needs SHIPMOZO_* on the server. */
      shipmozoEnabled: z.boolean(),
      /** Push confirmed orders to Shipmozo automatically (background job) instead of waiting for an admin. */
      autoCreateShipments: z.boolean(),
      /** After pushing, ask Shipmozo to pick a courier using the panel's Settings > Auto assign rules. */
      autoAssignCourier: z.boolean(),
      /** Refuse checkout when Shipmozo reports a seller → customer pincode pair as not serviceable. */
      blockUnserviceable: z.boolean(),
      /** Fallback package used when a product has no shipping weight/dimensions. */
      defaultPackage: z.object({
        weightGrams: z.number().int().min(1).max(500_000),
        lengthCm: z.number().min(1).max(500),
        widthCm: z.number().min(1).max(500),
        heightCm: z.number().min(1).max(500),
      }),
    }),
    defaults: {
      flatFee: 0,
      freeAbove: 0,
      shipmozoEnabled: false,
      autoCreateShipments: false,
      autoAssignCourier: false,
      blockUnserviceable: false,
      defaultPackage: { weightGrams: 500, lengthCm: 20, widthCm: 15, heightCm: 10 },
    },
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
