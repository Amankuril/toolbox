import { describe, expect, it } from 'vitest';
import { createSmsIndiaHubProvider, parseSmsIndiaHubResponse } from '#services/sms/providers/smsindiahub.provider.js';

const BASE = 'https://cloud.smsindiahub.in/vendorsms/pushsms.aspx';

function provider(reply, seen = {}) {
  return createSmsIndiaHubProvider({
    baseUrl: BASE,
    apiKey: 'KEY123',
    senderId: 'DKNWLH',
    fetchImpl: async (url) => {
      seen.url = new URL(url);
      return new Response(reply.body, { status: reply.status ?? 200 });
    },
  });
}

describe('SMSIndiaHub provider', () => {
  it('sends the pushsms parameters with the DLT template id', async () => {
    const seen = {};
    const res = await provider(
      { body: '{"ErrorCode":"000","ErrorMessage":"Done","JobId":"77","MessageData":[{"MessageId":"m-1"}]}' },
      seen,
    ).send({
      to: '+917974161582',
      text: 'Welcome to Toolshubs. Your login OTP is 123456. Please do not share this OTP with anyone.DKNWLH',
      templateId: '1077353780027406628',
    });
    expect(res).toMatchObject({ provider: 'smsindiahub', messageId: 'm-1' });
    expect(Object.fromEntries(seen.url.searchParams)).toEqual({
      APIKey: 'KEY123',
      sid: 'DKNWLH',
      msisdn: '917974161582',
      msg: 'Welcome to Toolshubs. Your login OTP is 123456. Please do not share this OTP with anyone.DKNWLH',
      gwid: '2',
      fl: '0',
      DLT_TE_ID: '1077353780027406628',
    });
  });

  it('treats HTTP 200 failures (JSON codes and plain text) as failures', async () => {
    const mismatch = await provider({ body: '{"ErrorCode":"006","ErrorMessage":"Invalid template"}' })
      .send({ to: '+919800000000', text: 'x' })
      .catch((e) => e);
    expect(mismatch).toMatchObject({ code: 'SMS_SEND_FAILED' });
    expect(mismatch.cause.message).toContain('DLT template mismatch');
    const text = await provider({ body: 'Failed#Parameter Missing' })
      .send({ to: '+919800000000', text: 'x' })
      .catch((e) => e);
    expect(text.code).toBe('SMS_SEND_FAILED');
    expect(parseSmsIndiaHubResponse(500, 'oops')).toMatchObject({ ok: false, code: 'HTTP_500' });
    expect(parseSmsIndiaHubResponse(200, 'Sent.')).toMatchObject({ ok: true, unverified: true });
  });

  it('refuses to start without an API key or sender id', () => {
    expect(() => createSmsIndiaHubProvider({ baseUrl: BASE, senderId: 'DKNWLH' })).toThrow(/apiKey/);
  });
});
