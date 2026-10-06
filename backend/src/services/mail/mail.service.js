import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { ApiError } from '#core/errors/ApiError.js';
import { createConsoleMailProvider } from './providers/console.provider.js';
import { createSmtpMailProvider } from './providers/smtp.provider.js';
import { otpEmail } from './templates.js';

/** Email is optional: without SMTP the API still runs, and only email sign-in reports it's unavailable. */
function disabledProvider(reason) {
  logger.warn(`Email sending is disabled: ${reason}. Email sign-in will be unavailable.`);
  return {
    name: 'disabled',
    async send() {
      throw ApiError.serviceUnavailable('Sign-in by email is not available right now. Please use your mobile number.', {
        code: 'EMAIL_UNAVAILABLE',
      });
    },
  };
}

function buildProvider() {
  if (env.MAIL_PROVIDER === 'smtp') {
    if (!env.SMTP_USER || !env.SMTP_PASS) return disabledProvider('MAIL_PROVIDER=smtp but SMTP_USER / SMTP_PASS are missing');
    return createSmtpMailProvider({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: `"${env.MAIL_FROM_NAME.replace(/"/g, '')}" <${env.MAIL_FROM || env.SMTP_USER}>`,
    });
  }
  // Never "send" OTPs into the server log in production.
  if (env.isProduction) return disabledProvider('MAIL_PROVIDER is not smtp');
  return createConsoleMailProvider();
}

let provider = buildProvider();

/** Centralised email service; every outbound email goes through here (mirrors smsService). */
export const mailService = {
  get providerName() {
    return provider.name;
  },

  async sendOtp(to, otp) {
    const message = otpEmail({ app: env.APP_NAME, otp, minutes: Math.round(env.OTP_TTL_SECONDS / 60) });
    const result = await provider.send({ to, ...message });
    logger.debug({ to, provider: result.provider, messageId: result.messageId }, 'OTP email sent');
    return result;
  },

  /** Test seam: replace the provider. */
  useProvider(next) {
    provider = next;
  },

  get provider() {
    return provider;
  },
};
