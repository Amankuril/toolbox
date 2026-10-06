import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { inject } from 'vitest';

// Runs before each test file's imports are evaluated, so env.js sees these values.
const runId = crypto.randomBytes(4).toString('hex');
const base = inject('mongoUri').replace(/\/?$/, '/');

Object.assign(process.env, {
  NODE_ENV: 'test',
  MONGODB_URI: `${base}toolbox_test_${runId}`,
  REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379/15',
  REDIS_KEY_PREFIX: `tbtest:${runId}:`,
  JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough-1234567890',
  JWT_ONBOARDING_SECRET: 'test-onboarding-secret-that-is-long-enough-12345',
  OTP_HMAC_SECRET: 'test-otp-hmac-secret-that-is-long-enough-12345678',
  DATA_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  SMS_PROVIDER: 'console',
  LOCAL_UPLOAD_DIR: path.join(os.tmpdir(), `toolbox-test-uploads-${runId}`),
  CORS_ORIGINS: 'http://localhost:5173',
  // Lets the admin toggle be switched on; tests swap in a fake provider so nothing hits the network.
  RAZORPAY_KEY_ID: 'rzp_test_key',
  RAZORPAY_KEY_SECRET: 'rzp_test_secret',
  RAZORPAY_WEBHOOK_SECRET: 'rzp_webhook_secret',
  // Same idea for Shipmozo: lets the toggle be switched on; tests swap in a fake provider.
  SHIPMOZO_PUBLIC_KEY: 'smz_test_public',
  SHIPMOZO_PRIVATE_KEY: 'smz_test_private',
});
