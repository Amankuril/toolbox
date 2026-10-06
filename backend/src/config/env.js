import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadEnvFallback(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      let clean = trimmed;
      if (clean.startsWith('export ')) clean = clean.slice(7).trim();
      const eqIdx = clean.indexOf('=');
      if (eqIdx === -1) continue;
      const key = clean.slice(0, eqIdx).trim();
      let val = clean.slice(eqIdx + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) {
        process.env[key] = val;
      }
    }
  } catch {
    // Ignore read errors
  }
}

function loadEnvFile(filePath) {
  if (typeof process.loadEnvFile === 'function') {
    try {
      process.loadEnvFile(filePath);
      return;
    } catch {
      // Fallback if built-in throws
    }
  }
  loadEnvFallback(filePath);
}

// In test environment, skip auto-loading .env so tests remain isolated
if (process.env.NODE_ENV !== 'test') {
  const nodeEnv = process.env.NODE_ENV;
  const candidates = [
    process.env.ENV_FILE,
    process.env.DOTENV_CONFIG_PATH,
    nodeEnv ? path.resolve(backendRoot, `.env.${nodeEnv}`) : null,
    nodeEnv ? path.resolve(process.cwd(), `.env.${nodeEnv}`) : null,
    path.resolve(backendRoot, '.env'),
    path.resolve(process.cwd(), '.env'),
    path.resolve(backendRoot, '../.env'),
  ].filter(Boolean);

  const seen = new Set();
  for (const file of candidates) {
    if (!seen.has(file) && fs.existsSync(file)) {
      seen.add(file);
      loadEnvFile(file);
    }
  }
}

const bool = (fallback) =>
  z
    .enum(['true', 'false', '1', '0'])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === 'true' || v === '1'));

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(5000),
    APP_NAME: z.string().default('ToolsHubs'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    TRUST_PROXY: z.coerce.number().int().min(0).default(1),

    // Comma separated list of browser origins allowed to call the API.
    CORS_ORIGINS: csv,
    PUBLIC_APP_URL: z.url().default('http://localhost:5173'),

    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
    REDIS_KEY_PREFIX: z.string().default('tb:'),

    JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 chars'),
    JWT_ACCESS_TTL: z.string().default('15m'),
    JWT_ONBOARDING_SECRET: z.string().min(32, 'JWT_ONBOARDING_SECRET must be at least 32 chars'),
    JWT_ONBOARDING_TTL: z.string().default('20m'),
    REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
    COOKIE_DOMAIN: z.string().optional(),
    COOKIE_SECURE: bool(undefined),

    // 32 byte key (hex or base64) used for AES-256-GCM encryption of sensitive fields (bank a/c numbers).
    DATA_ENCRYPTION_KEY: z.string().min(32, 'DATA_ENCRYPTION_KEY is required'),

    OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
    OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().positive().default(45),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    OTP_MAX_SENDS_PER_HOUR: z.coerce.number().int().positive().default(5),
    OTP_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
    OTP_HMAC_SECRET: z.string().min(32, 'OTP_HMAC_SECRET must be at least 32 chars'),
    DUMMY_NUMBERS: csv,

    SMS_PROVIDER: z.enum(['console', 'smsindiahub']).default('console'),
    SMSINDIAHUB_BASE_URL: z.url().default('https://cloud.smsindiahub.in/api/mt/SendSMS'),
    SMSINDIAHUB_API_KEY: z.string().optional(),
    SMSINDIAHUB_SENDER_ID: z.string().optional(),
    SMSINDIAHUB_CHANNEL: z.string().default('2'),
    SMSINDIAHUB_ROUTE: z.string().optional(),
    SMSINDIAHUB_ENTITY_ID: z.string().optional(),
    SMSINDIAHUB_OTP_TEMPLATE_ID: z.string().optional(),
    // Must match the DLT-approved template character for character. Placeholders: {otp} {minutes} {app}
    SMSINDIAHUB_OTP_TEMPLATE: z
      .string()
      .default('{otp} is your {app} verification code. It is valid for {minutes} minutes. Do not share it with anyone.'),

    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    CLOUDINARY_FOLDER: z.string().default('toolshubs'),

    LOCAL_UPLOAD_DIR: z.string().optional(),
    LOCAL_UPLOAD_PUBLIC_PATH: z.string().default('/uploads'),
    UPLOAD_MAX_FILE_SIZE_MB: z.coerce.number().positive().default(8),
    UPLOAD_MAX_FILES: z.coerce.number().int().positive().default(10),
    IMAGE_MAX_DIMENSION: z.coerce.number().int().positive().default(1600),
    IMAGE_WEBP_QUALITY: z.coerce.number().int().min(40).max(100).default(80),

    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    ORDER_PAYMENT_WINDOW_MINUTES: z.coerce.number().int().positive().default(30),

    // Shipmozo shipping. The base URL must not end with "/" (Shipmozo docs: trailing slash causes CORS errors).
    SHIPMOZO_BASE_URL: z.url().default('https://shipping-api.com/app/api/v1'),
    SHIPMOZO_PUBLIC_KEY: z.string().optional(),
    SHIPMOZO_PRIVATE_KEY: z.string().optional(),
    // Free India Post API used to auto-fill city/state from a pincode (no key needed).
    PINCODE_LOOKUP_URL: z.url().default('https://api.postalpincode.in/pincode'),
    PINCODE_LOOKUP_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    SHIPMOZO_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;
    if (env.SMS_PROVIDER === 'console') {
      ctx.addIssue({ code: 'custom', path: ['SMS_PROVIDER'], message: 'console SMS provider is not allowed in production' });
    }
    if (env.CORS_ORIGINS.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['CORS_ORIGINS'], message: 'CORS_ORIGINS is required in production' });
    }
  });

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  // Logger depends on env, so this is the one place we write to stderr directly.
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

const raw = parsed.data;
const isProduction = raw.NODE_ENV === 'production';

const rawUploadDir = raw.LOCAL_UPLOAD_DIR?.trim();
const rawPublicPath = raw.LOCAL_UPLOAD_PUBLIC_PATH?.trim();

// Detect if a server filesystem path (e.g. /var/www/...) was mistakenly passed in LOCAL_UPLOAD_PUBLIC_PATH
const isFilesystemPath = (p) => Boolean(p && /^(\/var|\/root|\/home|\/usr|\/opt|\/srv|[a-zA-Z]:[/\\])/i.test(p));

let localUploadDir;
let localUploadPublicPath;

if (rawUploadDir) {
  localUploadDir = path.resolve(rawUploadDir);
} else if (isFilesystemPath(rawPublicPath)) {
  // Auto-correct: user provided the disk path in LOCAL_UPLOAD_PUBLIC_PATH
  localUploadDir = path.resolve(rawPublicPath);
} else {
  localUploadDir = path.resolve(isProduction ? '/var/www/toolshubs/uploads' : path.join(backendRoot, 'uploads'));
}

if (rawPublicPath && !isFilesystemPath(rawPublicPath)) {
  localUploadPublicPath = rawPublicPath.startsWith('/') ? rawPublicPath.replace(/\/+$/, '') || '/uploads' : `/${rawPublicPath}`;
} else {
  localUploadPublicPath = '/uploads';
}

export const env = Object.freeze({
  ...raw,
  isProduction,
  isTest: raw.NODE_ENV === 'test',
  isDevelopment: raw.NODE_ENV === 'development',
  backendRoot,
  COOKIE_SECURE: raw.COOKIE_SECURE ?? isProduction,
  CORS_ORIGINS: raw.CORS_ORIGINS.length ? raw.CORS_ORIGINS : ['http://localhost:5173'],
  LOCAL_UPLOAD_DIR: localUploadDir,
  LOCAL_UPLOAD_PUBLIC_PATH: localUploadPublicPath,
  cloudinaryConfigured: Boolean(raw.CLOUDINARY_CLOUD_NAME && raw.CLOUDINARY_API_KEY && raw.CLOUDINARY_API_SECRET),
  razorpayConfigured: Boolean(raw.RAZORPAY_KEY_ID && raw.RAZORPAY_KEY_SECRET),
  SHIPMOZO_BASE_URL: raw.SHIPMOZO_BASE_URL.replace(/\/+$/, ''),
  PINCODE_LOOKUP_URL: raw.PINCODE_LOOKUP_URL.replace(/\/+$/, ''),
  shipmozoConfigured: Boolean(raw.SHIPMOZO_PUBLIC_KEY && raw.SHIPMOZO_PRIVATE_KEY),
});

/** Normalises mobile phone digits to 10-digit format for matching. */
export function normalizePhoneDigits(phone) {
  if (!phone) return '';
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

/** Checks whether a phone number matches any configured dummy number. */
export function isDummyNumber(phone) {
  if (!phone) return false;
  const digits = normalizePhoneDigits(phone);
  if (!digits) return false;
  const rawFromEnv = process.env.DUMMY_NUMBERS
    ? process.env.DUMMY_NUMBERS.split(',').map((s) => s.trim()).filter(Boolean)
    : (env.DUMMY_NUMBERS || []);
  return rawFromEnv.some((n) => normalizePhoneDigits(n) === digits);
}

