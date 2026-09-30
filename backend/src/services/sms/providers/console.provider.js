import { logger } from '#config/logger.js';

/**
 * Development / test provider: logs messages instead of sending them.
 * Refused in production by env validation.
 */
export function createConsoleProvider() {
  const outbox = [];
  return {
    name: 'console',
    async send({ to, text }) {
      outbox.push({ to, text, at: new Date() });
      if (outbox.length > 50) outbox.shift();
      logger.info({ to, text }, '[sms:console] message');
      return { provider: 'console', messageId: `console-${Date.now()}` };
    },
    /** Test helper: last message sent to a number. */
    lastMessageTo(to) {
      return [...outbox].reverse().find((m) => m.to === to);
    },
  };
}
