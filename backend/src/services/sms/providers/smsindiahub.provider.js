import { ApiError } from '#core/errors/ApiError.js';

const SUCCESS_CODE = '000';
const SEND_FAILED = 'We could not send the SMS right now. Please try again shortly.';

/**
 * SMSIndiaHub answers HTTP 200 for failures too. Success is JSON `{"ErrorCode":"000", ...}`;
 * failures come as JSON with another code, or as plain text such as "Failed#Parameter Missing".
 */
export function parseSmsIndiaHubResponse(status, text) {
  const body = String(text ?? '').trim();
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* plain text */
  }
  if (parsed && typeof parsed === 'object' && 'ErrorCode' in parsed) {
    const code = String(parsed.ErrorCode);
    return code === SUCCESS_CODE
      ? { ok: true, messageId: parsed.MessageData?.[0]?.MessageId ?? parsed.JobId }
      : { ok: false, code, reason: parsed.ErrorMessage || body };
  }
  if (status < 200 || status >= 300) return { ok: false, code: `HTTP_${status}`, reason: body };
  if (!body || /fail|error|invalid|missing|denied|insufficient|blocked/i.test(body))
    return { ok: false, code: 'TEXT', reason: body || 'empty response' };
  // Unrecognised but not an error: accepted (the delivery report in the panel is the final word).
  return { ok: true, unverified: true };
}

/**
 * SMSIndiaHub "pushsms" HTTP API (GET vendorsms/pushsms.aspx), the same call used in production
 * by our other apps on this account. India's DLT rules apply: `sid` must be the header linked
 * to the template, `DLT_TE_ID` the approved template id, and the text must match it exactly.
 */
export function createSmsIndiaHubProvider({ baseUrl, apiKey, senderId, channel = '2', username, timeoutMs = 15_000, fetchImpl = fetch }) {
  const missing = Object.entries({ apiKey, senderId })
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
        sid: senderId,
        // Country code without "+", e.g. 917974161582.
        msisdn: to.replace(/^\+/, ''),
        msg: text,
        gwid: channel,
        fl: '0',
        ...(username ? { uname: username } : {}),
        ...(templateId ? { DLT_TE_ID: templateId } : {}),
      }).toString();

      let response;
      try {
        response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
      } catch (err) {
        throw ApiError.serviceUnavailable('Could not reach the SMS gateway. Please try again.', { cause: err, code: 'SMS_UNREACHABLE' });
      }

      const result = parseSmsIndiaHubResponse(response.status, await response.text().catch(() => ''));
      if (!result.ok) {
        // 006 = DLT template mismatch: text differs from the approved template, or sid isn't its header.
        const hint = result.code === '006' ? ' (DLT template mismatch: check SMSINDIAHUB_OTP_TEMPLATE and SMSINDIAHUB_SENDER_ID)' : '';
        throw ApiError.serviceUnavailable(SEND_FAILED, {
          code: 'SMS_SEND_FAILED',
          cause: new Error(`SMSIndiaHub ${response.status}: [${result.code}] ${String(result.reason).slice(0, 200)}${hint}`),
        });
      }
      return { provider: 'smsindiahub', messageId: result.messageId ?? null, unverified: Boolean(result.unverified) };
    },
  };
}
