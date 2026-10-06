import nodemailer from 'nodemailer';
import { ApiError } from '#core/errors/ApiError.js';

/**
 * Plain SMTP (Gmail, Zoho, SES SMTP, Brevo…). For Gmail use smtp.gmail.com:465 with an
 * App Password (Google Account → Security → 2-Step Verification → App passwords).
 */
export function createSmtpMailProvider({ host, port, secure, user, pass, from, timeoutMs = 15_000 }) {
  const missing = Object.entries({ host, user, pass, from })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) throw new Error(`SMTP mail provider misconfigured, missing: ${missing.join(', ')}`);

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Pooled connections: OTP bursts reuse one TLS session instead of a handshake per email.
    pool: true,
    maxConnections: 3,
    connectionTimeout: timeoutMs,
    greetingTimeout: timeoutMs,
    socketTimeout: timeoutMs,
    // Message content is always our own templates; never let it pull files or URLs.
    disableFileAccess: true,
    disableUrlAccess: true,
  });

  return {
    name: 'smtp',
    async send({ to, subject, text, html }) {
      try {
        const info = await transport.sendMail({ from, to, subject, text, html });
        if (info.rejected?.length) throw new Error(`rejected: ${info.rejected.join(', ')}`);
        return { provider: 'smtp', messageId: info.messageId };
      } catch (err) {
        throw ApiError.serviceUnavailable('We could not send the email right now. Please try again shortly.', {
          code: 'EMAIL_SEND_FAILED',
          cause: new Error(`SMTP ${err.code ?? ''} ${err.responseCode ?? ''}: ${String(err.response ?? err.message).slice(0, 200)}`),
        });
      }
    },
    /** Checks connection + login without sending anything. */
    verify: () => transport.verify(),
    close: () => transport.close(),
  };
}
