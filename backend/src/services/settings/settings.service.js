import { env } from '#config/env.js';
import { cached } from '#core/cache/cached.js';
import { ApiError } from '#core/errors/ApiError.js';
import { Setting } from '#modules/settings/setting.model.js';
import { SETTING_KEYS, SETTINGS } from '#modules/settings/settings.schema.js';

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Stored values are merged over defaults so newly added fields always have a value. */
function mergeDefaults(defaults, stored) {
  if (!isPlainObject(defaults) || !isPlainObject(stored)) return stored ?? defaults;
  const out = { ...defaults };
  for (const [k, v] of Object.entries(stored)) {
    if (k in defaults) out[k] = isPlainObject(defaults[k]) ? mergeDefaults(defaults[k], v) : v;
  }
  return out;
}

/** Older documents had one logo/favicon for everything; carry it over to every module. */
function upgradeBranding(branding) {
  if (!branding || branding.modules || !(branding.logo || branding.favicon)) return branding;
  const shared = { logo: branding.logo ?? null, favicon: branding.favicon ?? null };
  return { ...branding, modules: { user: shared, vendor: shared, admin: shared } };
}

const store = cached('settings', async () => {
  const docs = await Setting.find({ key: { $in: SETTING_KEYS } }).lean();
  const stored = Object.fromEntries(docs.map((d) => [d.key, d.value]));
  stored.branding = upgradeBranding(stored.branding);
  return Object.fromEntries(SETTING_KEYS.map((key) => [key, mergeDefaults(SETTINGS[key].defaults, stored[key])]));
});

/** Stops an admin from enabling an integration whose credentials are missing on the server. */
function assertIntegrationsConfigured(key, value) {
  if (key === 'storage' && value.cloudinaryEnabled && !env.cloudinaryConfigured) {
    throw ApiError.unprocessable('Cloudinary is not configured on the server. Add the CLOUDINARY_* variables first.', {
      code: 'INTEGRATION_NOT_CONFIGURED',
    });
  }
  if (key === 'payments' && value.razorpayEnabled && !env.razorpayConfigured) {
    throw ApiError.unprocessable('Razorpay is not configured on the server. Add the RAZORPAY_* variables first.', {
      code: 'INTEGRATION_NOT_CONFIGURED',
    });
  }
}

/**
 * Admin-managed runtime settings (theme, storage toggle, payments, moderation...).
 * Cached per instance and invalidated cluster-wide on change.
 */
export const settingsService = {
  all: () => store.get(),

  async get(key) {
    return (await store.get())[key];
  },

  /**
   * Validates and saves a settings group. Partial input is merged over the current value.
   * @param {string} key
   * @param {object} patch
   * @param {{ kind: string, id?: any }} actor
   */
  async update(key, patch, actor) {
    const definition = SETTINGS[key];
    if (!definition) throw ApiError.notFound(`Unknown settings group: ${key}`);

    const next = definition.schema.parse(mergeDefaults(await this.get(key), patch));
    assertIntegrationsConfigured(key, next);

    await Setting.findOneAndUpdate({ key }, { value: next, updatedBy: actor }, { upsert: true });
    await store.invalidate();
    return next;
  },

  invalidate: () => store.clear(),

  /** Safe subset exposed to anonymous clients. */
  async publicView() {
    const values = await store.get();
    const razorpayEnabled = values.payments.razorpayEnabled && env.razorpayConfigured;
    return {
      branding: values.branding,
      theme: values.theme,
      payments: {
        razorpayEnabled,
        razorpayKeyId: razorpayEnabled ? env.RAZORPAY_KEY_ID : null,
        codEnabled: values.payments.codEnabled,
        codMaxOrderValue: values.payments.codMaxOrderValue,
      },
      shipping: values.shipping,
    };
  },

  /** Admin view adds server integration status so the UI can explain disabled toggles. */
  async adminView() {
    return {
      ...(await store.get()),
      integrations: {
        cloudinary: { configured: env.cloudinaryConfigured },
        razorpay: { configured: env.razorpayConfigured, webhookConfigured: Boolean(env.RAZORPAY_WEBHOOK_SECRET) },
        sms: { provider: env.SMS_PROVIDER },
        localStorage: { directory: env.LOCAL_UPLOAD_DIR, publicPath: env.LOCAL_UPLOAD_PUBLIC_PATH },
      },
    };
  },
};
