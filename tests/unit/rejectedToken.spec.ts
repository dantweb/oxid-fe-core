import { describe, expect, it } from 'vitest';
import { GraphqlError } from '../../src/api/GraphqlError';
import { isRejectedToken } from '../../src/auth/rejectedToken';

const fromMessage = (message: string, errorCode?: string): GraphqlError =>
  GraphqlError.fromErrors([{ message, extensions: errorCode ? { errorCode } : undefined }]);

describe('isRejectedToken', () => {
  it.each([
    ['the shop code', fromMessage('whatever', 'invalid_token')],
    ['a rejected signature or expiry', fromMessage('The access token is invalid')],
    ['an unparseable token', fromMessage('Unable to parse token')],
  ])('recognises %s', (_name, error) => {
    expect(isRejectedToken(error)).toBe(true);
  });

  it.each([
    ['a wrong password', fromMessage('Username/password combination is invalid')],
    ['a business error code', fromMessage('Basket not found', 'basket_not_found')],
    ['a network failure', new Error('The access token is invalid')],
    ['a non-error', 'The access token is invalid'],
    ['nothing', undefined],
  ])('ignores %s', (_name, error) => {
    expect(isRejectedToken(error)).toBe(false);
  });
});
