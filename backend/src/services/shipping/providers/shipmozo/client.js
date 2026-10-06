import { ShippingProviderError } from '../../shipping.errors.js';

/**
 * Thin Shipmozo HTTP client. Every call carries the `public-key` / `private-key` headers,
 * has a timeout, and is judged by the body's `result` ("1" = success, "0" = failure),
 * never by HTTP 200 alone.
 */
export function createShipmozoClient({ baseUrl, publicKey, privateKey, timeoutMs = 15_000, fetchImpl = fetch }) {
  if (!publicKey || !privateKey) throw new Error('Shipmozo client misconfigured: public and private keys are required');
  const root = baseUrl.replace(/\/+$/, '');

  async function call(method, path, { body, query } = {}) {
    const url = new URL(`${root}${path}`);
    if (query) url.search = new URLSearchParams(query).toString();
    // Path parameters (AWB, order id) are left out of the operation name used in logs/errors.
    const operation = `${method} /${path.split('/')[1]}`;

    let response;
    try {
      response = await fetchImpl(url, {
        method,
        headers: {
          accept: 'application/json',
          'public-key': publicKey,
          'private-key': privateKey,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      // A POST that never answered may still have been applied on Shipmozo's side.
      throw new ShippingProviderError(timedOut ? 'timeout' : 'network', `Shipmozo ${operation} ${timedOut ? 'timed out' : 'unreachable'}`, {
        operation,
        outcomeUnknown: method !== 'GET',
        cause: err,
      });
    }

    const json = await response.json().catch(() => null);

    if (response.status === 401 || response.status === 403) {
      throw new ShippingProviderError('auth', `Shipmozo rejected the API keys (${response.status})`, { operation, status: response.status });
    }
    if (!json || typeof json !== 'object') {
      throw new ShippingProviderError(response.ok ? 'invalid_response' : 'http', `Shipmozo ${operation} returned ${response.status} without JSON`, {
        operation,
        status: response.status,
        // A 5xx on a write may have been partially applied.
        outcomeUnknown: method !== 'GET' && response.status >= 500,
      });
    }
    if (String(json.result) !== '1') {
      const providerMessage = describeFailure(json);
      throw new ShippingProviderError('rejected', `Shipmozo ${operation} failed: ${providerMessage}`, {
        operation,
        status: response.status,
        providerMessage,
      });
    }
    return json.data;
  }

  return {
    get: (path, opts) => call('GET', path, opts),
    post: (path, body) => call('POST', path, { body }),
  };
}

/** Failure bodies look like { result: "0", message: "Error", data: { error: "please setup auto assign" } }. */
function describeFailure(json) {
  const detail = json.data?.error ?? (typeof json.data === 'string' ? json.data : null);
  const message = typeof json.message === 'string' ? json.message : 'Request failed';
  const text = detail && detail !== message ? `${message}: ${detail}` : message;
  return String(text).slice(0, 300);
}
