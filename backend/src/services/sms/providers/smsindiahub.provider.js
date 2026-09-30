import { ApiError } from '#core/errors/ApiError.js';

const SUCCESS_CODE = '000';

/**
 * SMSIndiaHub transactional HTTP API (GET /api/mt/SendSMS).
 * India requires DLT registration: `entityId` (PE ID) and the approved `templateId`
 * must be sent, and the text must match the approved template exactly.
 *
 * Response: { ErrorCode: "000", ErrorMessage: "Done", JobId, MessageData: [{ Number, MessageId }] }
 */
export function createSmsIndiaHubProvider({ baseUrl, apiKey, senderId, channel, route, entityId, timeoutMs = 10_000 }) {
  const missing = Object.entries({ apiKey, senderId, route, entityId })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length) {
    throw new Error(`SMSIndiaHub provider misconfigured, missing: ${missing.join(', ')}`);
  }

  return {
    name: 'smsindiahub',
    async send({ to, text, templateId }) {
      const url = new URL(baseUrl);
      url.search = new URLSearchParams({
        APIKey: apiKey,
        senderid: senderId,
        channel,
        DCS: '0',
        flashsms: '0',
        // SMSIndiaHub expects the country code without "+", e.g. 919876543210.
        number: to.replace(/^\+/, ''),
        text,
        route,
        EntityId: entityId,
        ...(templateId ? { dlttemplateid: templateId } : {}),
      }).toString();

      let response;
      try {
        response = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        throw ApiError.serviceUnavailable('Could not reach the SMS gateway. Please try again.', { cause: err, code: 'SMS_UNREACHABLE' });
      }

      const body = await response.json().catch(() => null);
      if (!response.ok || !body || body.ErrorCode !== SUCCESS_CODE) {
        throw ApiError.serviceUnavailable('We could not send the SMS right now. Please try again shortly.', {
          code: 'SMS_SEND_FAILED',
          cause: new Error(`SMSIndiaHub ${response.status}: ${body?.ErrorCode} ${body?.ErrorMessage}`),
        });
      }

      return { provider: 'smsindiahub', messageId: body.MessageData?.[0]?.MessageId ?? body.JobId };
    },
  };
}
