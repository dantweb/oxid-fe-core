import { ERROR_CODE_HTTP, ERROR_CODE_NETWORK, GraphqlError } from './GraphqlError';

/**
 * Codes the shop modules put into `extensions.errorCode` (graphql-base, payment-base and the
 * provider modules), plus the two the client itself raises for a transport failure. A frontend
 * maps these to translated texts instead of rendering `error.message`.
 */
const SHOP_ERROR_CODES = [
  'basket_not_found',
  'payment_not_supported',
  'terms_not_confirmed',
  'return_url_rejected',
  'provider_failed',
  'contract_not_found',
  'invalid_token',
  'invalid_login',
  'account_exists',
  'guest_details_required',
] as const;

export type ShopErrorCode = (typeof SHOP_ERROR_CODES)[number];
export type TransportErrorCode = typeof ERROR_CODE_NETWORK | typeof ERROR_CODE_HTTP;
export type KnownErrorCode = ShopErrorCode | TransportErrorCode;

const KNOWN_CODES: ReadonlySet<string> = new Set<string>([
  ...SHOP_ERROR_CODES,
  ERROR_CODE_NETWORK,
  ERROR_CODE_HTTP,
]);

/** The known code of an error, or `undefined` for an unknown code or anything but a GraphqlError. */
export function errorCodeOf(error: unknown): KnownErrorCode | undefined {
  if (!(error instanceof GraphqlError) || !KNOWN_CODES.has(error.errorCode)) {
    return undefined;
  }
  return error.errorCode as KnownErrorCode;
}

/**
 * The provider's own code (`extensions.providerCode`, e.g. Stripe's `card_declined`) — free-form,
 * so a plain string; `undefined` when the error carries none.
 */
export function providerCodeOf(error: unknown): string | undefined {
  return error instanceof GraphqlError ? error.providerCode : undefined;
}
