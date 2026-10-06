import { ApiError } from '#core/errors/ApiError.js';

/**
 * Raised by shipping providers. `kind` is one of:
 *   timeout | network | auth | http | invalid_response | rejected
 * `outcomeUnknown` means a write may or may not have been applied by the provider,
 * so it must be verified before it is retried.
 */
export class ShippingProviderError extends Error {
  constructor(kind, message, { operation, status, providerMessage, outcomeUnknown = false, cause } = {}) {
    super(message, { cause });
    this.name = 'ShippingProviderError';
    this.kind = kind;
    this.operation = operation;
    this.status = status;
    this.providerMessage = providerMessage;
    this.outcomeUnknown = outcomeUnknown;
  }
}

/**
 * Converts a provider error into a client-safe ApiError.
 * `audience: 'admin'` includes the provider's own rejection message (e.g. "Order not found"),
 * which helps operators; customers only ever get a generic message.
 */
export function toApiError(err, { audience = 'admin', fallback = 'Shipping request failed' } = {}) {
  if (!(err instanceof ShippingProviderError)) return err;
  if (err.kind === 'rejected') {
    const message = audience === 'admin' && err.providerMessage ? `Shipmozo: ${err.providerMessage}` : fallback;
    return ApiError.unprocessable(message, { code: 'SHIPPING_REJECTED', cause: err });
  }
  if (err.kind === 'auth') {
    return ApiError.serviceUnavailable('Shipping provider is misconfigured. Please contact support.', {
      code: 'SHIPPING_AUTH_FAILED',
      cause: err,
    });
  }
  return ApiError.serviceUnavailable('The shipping provider is not reachable right now. Please try again shortly.', {
    code: err.kind === 'timeout' ? 'SHIPPING_TIMEOUT' : 'SHIPPING_UNAVAILABLE',
    cause: err,
  });
}
