import { logger } from '#config/logger.js';

/**
 * Development / test provider: logs emails instead of sending them.
 * Refused in production by env validation.
 */
export function createConsoleMailProvider() {
  const outbox = [];
  return {
    name: 'console',
    async send({ to, subject, text }) {
      outbox.push({ to, subject, text, at: new Date() });
      if (outbox.length > 50) outbox.shift();
      logger.info({ to, subject, text }, '[mail:console] message');
      return { provider: 'console', messageId: `console-${Date.now()}` };
    },
    /** Test helper: last email sent to an address. */
    lastMessageTo(to) {
      return [...outbox].reverse().find((m) => m.to === to);
    },
  };
}
