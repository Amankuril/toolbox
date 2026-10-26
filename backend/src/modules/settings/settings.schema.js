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
      user: { primary: '#1e5b38', secondary: '#10241a', accent: '#f5c518', radius: 'md' },
      vendor: { primary: '#1e5b38', secondary: '#10241a', accent: '#f5c518', radius: 'md' },
      admin: { primary: '#1e5b38', secondary: '#0c1a13', accent: '#f5c518', radius: 'md' },
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
      /** Pay part online now (Razorpay), the rest in cash to the courier. Needs Razorpay. */
      partialEnabled: z.boolean(),
      /** Share charged up front, in percent. */
      partialAdvancePercent: z.number().int().min(5).max(90),
      /** Offered only for orders at or above this total (paise). 0 = every order. */
      partialMinOrderValue: z.number().int().min(0),
      /** Most the courier may collect on delivery (paise). 0 = no limit. */
      partialMaxBalance: z.number().int().min(0),
      /** EMI through Razorpay (card and cardless EMI must be on in the Razorpay dashboard too). */
      emiEnabled: z.boolean(),
      /** Smallest order offered EMI, in paise (banks usually start at ₹3,000). */
      emiMinOrderValue: z.number().int().min(0),
      /** For the EMI calculator: typical yearly bank interest per tenure. Banks set the real rate at payment. */
      emiPlans: z
        .array(z.object({ months: z.number().int().min(2).max(60), rate: z.number().min(0).max(60) }))
        .max(12)
        .refine((plans) => new Set(plans.map((p) => p.months)).size === plans.length, 'Each tenure once'),
      /** Tenures shown as no-cost EMI (the seller or bank absorbs the interest). */
      noCostMonths: z.array(z.number().int().min(2).max(60)).max(6),
    }),
    defaults: {
      razorpayEnabled: false,
      codEnabled: true,
      codMaxOrderValue: 0,
      partialEnabled: false,
      partialAdvancePercent: 20,
      partialMinOrderValue: 0,
      partialMaxBalance: 0,
      emiEnabled: false,
      emiMinOrderValue: 300_000,
      emiPlans: [
        { months: 3, rate: 15 },
        { months: 6, rate: 15 },
        { months: 9, rate: 16 },
        { months: 12, rate: 16 },
        { months: 18, rate: 16 },
        { months: 24, rate: 16 },
      ],
      noCostMonths: [],
    },
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

  analytics: {
    schema: z.object({
      // Google Analytics 4 web stream ID. Public by design (it ships in the page); empty = analytics off.
      gaMeasurementId: z.union([
        z.literal(''),
        z
          .string()
          .trim()
          .toUpperCase()
          .regex(/^G-[A-Z0-9]{4,16}$/, 'Use the Measurement ID from GA4, like G-AB12CD34EF'),
      ]),
    }),
    defaults: { gaMeasurementId: '' },
  },

  /**
   * Search and social titles/descriptions. Templates fill {site}, {name}, {brand}, {price}, {category}, {city};
   * a product's or category's own SEO fields win over these.
   */
  seo: {
    schema: z.object({
      home: z.object({
        title: z.string().trim().max(160),
        description: z.string().trim().max(320),
        keywords: z.string().trim().max(500),
        ogTitle: z.string().trim().max(120),
        ogDescription: z.string().trim().max(300),
        ogImage: imageRef.nullable(),
      }),
      product: z.object({ title: z.string().trim().max(160), description: z.string().trim().max(320) }),
      category: z.object({ title: z.string().trim().max(160), description: z.string().trim().max(320) }),
      store: z.object({ title: z.string().trim().max(160), description: z.string().trim().max(320) }),
    }),
    defaults: {
      home: {
        title: '{site} — Tools for a Greener Tomorrow',
        description: 'Buy tools, machinery and spare parts from reviewed sellers across India, with bulk pricing and quotes for business buyers.',
        keywords: '',
        ogTitle: '',
        ogDescription: '',
        ogImage: null,
      },
      product: { title: '{name} | {site}', description: 'Buy {name} online at the best price in India on {site}.' },
      category: {
        title: '{name} | {site}',
        description: 'Shop {name} online at {site}: compare prices from reviewed sellers, with bulk pricing and quotes.',
      },
      store: { title: '{name} | {site}', description: 'Shop tools, machinery and spare parts from {name}{city} on {site}.' },
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
