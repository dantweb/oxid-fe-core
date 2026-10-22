import { describe, expect, it } from 'vitest';
import {
  ERROR_CODE_HTTP,
  ERROR_CODE_NETWORK,
  GraphqlError,
  type GraphqlErrorShape,
} from '../../src/api/GraphqlError';
import { errorCodeOf, providerCodeOf } from '../../src/api/errorCodes';

function shopError(extensions: GraphqlErrorShape['extensions']): GraphqlError {
  return GraphqlError.fromErrors([{ message: 'raw shop wording', extensions }]);
}

const SHOP_CODES = [
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

describe('errorCodeOf', () => {
  it.each(SHOP_CODES)('shopError_%s_returnsTheCode', (code) => {
    expect(errorCodeOf(shopError({ errorCode: code }))).toBe(code);
  });

  it('transportFailure_network_returnsNetworkError', () => {
    expect(errorCodeOf(new GraphqlError('down', ERROR_CODE_NETWORK))).toBe('network_error');
  });

  it('transportFailure_http_returnsHttpError', () => {
    expect(errorCodeOf(new GraphqlError('HTTP 502', ERROR_CODE_HTTP))).toBe('http_error');
  });

  it('shopError_unknownCode_returnsUndefined', () => {
    expect(errorCodeOf(shopError({ errorCode: 'something_new' }))).toBeUndefined();
  });

  it('shopError_onlyCategory_returnsUndefined', () => {
    expect(errorCodeOf(shopError({ category: 'NotFound' }))).toBeUndefined();
  });

  it('shopError_noExtensions_returnsUndefined', () => {
    expect(errorCodeOf(shopError(undefined))).toBeUndefined();
  });

  it.each([new Error('boom'), 'text', null, undefined, { errorCode: 'invalid_token' }])(
    'notAGraphqlError_%s_returnsUndefined',
    (value) => {
      expect(errorCodeOf(value)).toBeUndefined();
    },
  );
});

describe('providerCodeOf', () => {
  it('providerFailure_withProviderCode_returnsIt', () => {
    expect(
      providerCodeOf(shopError({ errorCode: 'provider_failed', providerCode: 'card_declined' })),
    ).toBe('card_declined');
  });

  it('shopError_withoutProviderCode_returnsUndefined', () => {
    expect(providerCodeOf(shopError({ errorCode: 'provider_failed' }))).toBeUndefined();
  });

  it('notAGraphqlError_returnsUndefined', () => {
    expect(providerCodeOf(new Error('boom'))).toBeUndefined();
  });
});
