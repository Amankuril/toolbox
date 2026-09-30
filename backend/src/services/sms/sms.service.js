import { env } from '#config/env.js';
import { logger } from '#config/logger.js';
import { createConsoleProvider } from './providers/console.provider.js';
import { createSmsIndiaHubProvider } from './providers/smsindiahub.provider.js';

function buildProvider() {
  switch (env.SMS_PROVIDER) {
    case 'smsindiahub':
      return createSmsIndiaHubProvider({
        baseUrl: env.SMSINDIAHUB_BASE_URL,
        apiKey: env.SMSINDIAHUB_API_KEY,
        senderId: env.SMSINDIAHUB_SENDER_ID,
        channel: env.SMSINDIAHUB_CHANNEL,
        route: env.SMSINDIAHUB_ROUTE,
        entityId: env.SMSINDIAHUB_ENTITY_ID,
      });
    case 'console':
    default:
      return createConsoleProvider();
  }
}

let provider = buildProvider();

function render(template, vars) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

/**
 * Centralised SMS service. Every outbound SMS in the app goes through here so the
 * provider can be swapped (or mocked in tests) in one place.
 */
export const smsService = {
  get providerName() {
    return provider.name;
  },

  async sendOtp(to, otp) {
    const text = render(env.SMSINDIAHUB_OTP_TEMPLATE, {
      otp,
      app: env.APP_NAME,
      minutes: Math.round(env.OTP_TTL_SECONDS / 60),
    });
    const result = await provider.send({ to, text, templateId: env.SMSINDIAHUB_OTP_TEMPLATE_ID });
    logger.debug({ to, provider: result.provider, messageId: result.messageId }, 'OTP SMS sent');
    return result;
  },

  /** Test seam: replace the provider (e.g. with the console provider to read OTPs). */
  useProvider(next) {
    provider = next;
  },

  get provider() {
    return provider;
  },
};
