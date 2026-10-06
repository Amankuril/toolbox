/**
 * Sends ONE real OTP SMS through SMSIndiaHub using the app's own message template and
 * provider, and prints what was sent and what the gateway answered. Costs one SMS credit.
 * Doesn't touch the database, and works even while SMS_PROVIDER=console.
 *
 *   npm run sms:test -- 98XXXXXXXX
 */
import crypto from 'node:crypto';
import { env } from '#config/env.js';
import { createSmsIndiaHubProvider } from '#services/sms/providers/smsindiahub.provider.js';
import { smsService } from '#services/sms/sms.service.js';

const phone = String(process.argv[2] ?? '')
  .replace(/\D/g, '')
  .slice(-10);
if (!/^[6-9]\d{9}$/.test(phone)) {
  console.error('Usage: npm run sms:test -- <10-digit mobile number>');
  process.exit(1);
}

let provider;
try {
  provider = createSmsIndiaHubProvider({
    baseUrl: env.SMSINDIAHUB_BASE_URL,
    apiKey: env.SMSINDIAHUB_API_KEY,
    senderId: env.SMSINDIAHUB_SENDER_ID,
    channel: env.SMSINDIAHUB_CHANNEL,
    username: env.SMSINDIAHUB_USERNAME,
  });
} catch (err) {
  console.error(`${err.message}. Fill these in backend/.env first.`);
  process.exit(1);
}
smsService.useProvider(provider);

const otp = String(crypto.randomInt(10 ** (env.OTP_LENGTH - 1), 10 ** env.OTP_LENGTH));
console.log(
  'SMS_PROVIDER    :',
  env.SMS_PROVIDER,
  env.SMS_PROVIDER === 'smsindiahub' ? '' : ' <- the app itself still uses this; set smsindiahub to send real OTPs',
);
console.log('Sender ID (sid) :', env.SMSINDIAHUB_SENDER_ID);
console.log('DLT template ID :', env.SMSINDIAHUB_OTP_TEMPLATE_ID || '(none)');
console.log(`Sending OTP ${otp} to +91${phone} ...`);

try {
  const result = await smsService.sendOtp(`+91${phone}`, otp);
  console.log(
    `\nAccepted by SMSIndiaHub${result.messageId ? ` (message id ${result.messageId})` : ''}${result.unverified ? ' - unrecognised reply, treated as accepted' : ''}.`,
  );
  console.log('If nothing arrives within a minute, check the delivery report for this number in the SMSIndiaHub panel.');
  process.exit(0);
} catch (err) {
  console.error('\nNOT sent:', err.message);
  if (err.cause) console.error('Gateway said:', err.cause.message);
  process.exit(1);
}
