import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { createConsoleMailProvider } from './providers/console.provider.js';
import { createSmtpMailProvider } from './providers/smtp.provider.js';
import { otpEmail } from './templates.js';

function buildProvider() {
  if (env.MAIL_PROVIDER === 'smtp') {
    return createSmtpMailProvider({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
      from: `"${env.MAIL_FROM_NAME.replace(/"/g, '')}" <${env.MAIL_FROM || env.SMTP_USER}>`,
    });
  }
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
