/**
 * Checks the SMTP login, then sends ONE real sign-in code email using the app's template.
 * Works even while MAIL_PROVIDER=console. Doesn't touch the database.
 *
 *   npm run mail:test -- you@example.com
 */
import crypto from 'node:crypto';
import { env } from '#config/env.js';
import { mailService } from '#services/mail/mail.service.js';
import { createSmtpMailProvider } from '#services/mail/providers/smtp.provider.js';

const to = String(process.argv[2] ?? '')
  .trim()
  .toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
  console.error('Usage: npm run mail:test -- <email address>');
  process.exit(1);
}

let provider;
try {
  provider = createSmtpMailProvider({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    user: env.SMTP_USER,
    pass: env.SMTP_PASS,
    from: `"${env.MAIL_FROM_NAME.replace(/"/g, '')}" <${env.MAIL_FROM || env.SMTP_USER}>`,
  });
} catch (err) {
  console.error(`${err.message}. Fill these in backend/.env first.`);
  process.exit(1);
}

console.log(
  'MAIL_PROVIDER :',
  env.MAIL_PROVIDER,
  env.MAIL_PROVIDER === 'smtp' ? '' : ' <- the app itself still logs emails; set smtp to send real ones',
);
console.log('SMTP          :', `${env.SMTP_USER} @ ${env.SMTP_HOST}:${env.SMTP_PORT}${env.SMTP_SECURE ? ' (TLS)' : ' (STARTTLS)'}`);
try {
  await provider.verify();
  console.log('Login         : OK');
} catch (err) {
  console.error('Login         : FAILED -', String(err.response ?? err.message).split('\n')[0]);
  if (err.responseCode === 535)
    console.error('For Gmail: SMTP_USER must be the account that created the App Password, with 2-Step Verification on.');
  process.exit(1);
}

mailService.useProvider(provider);
const otp = String(crypto.randomInt(10 ** (env.OTP_LENGTH - 1), 10 ** env.OTP_LENGTH));
try {
  const result = await mailService.sendOtp(to, otp);
  console.log(`Sent code ${otp} to ${to} (message id ${result.messageId}). Check the inbox and spam folder.`);
  provider.close();
  process.exit(0);
} catch (err) {
  console.error('NOT sent:', err.message, err.cause ? `- ${err.cause.message}` : '');
  process.exit(1);
}
