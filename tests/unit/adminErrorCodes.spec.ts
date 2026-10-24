import { describe, expect, expectTypeOf, it } from 'vitest';
import { GraphqlError } from '../../src/api/GraphqlError';
import { errorCodeOf, type AdminErrorCode, type KnownErrorCode } from '../../src/api/errorCodes';

/** The fixed list of the admin module (G01), mirrored here. */
const ADMIN_CODES = [
  'admin_session_required',
  'admin_session_revoked',
  'mfa_required',
  'mfa_invalid',
  'step_up_required',
  'permission_denied',
  'not_found',
  'validation_failed',
  'conflict',
  'not_deletable',
  'rate_limited',
] as const;

describe('errorCodeOf — admin codes', () => {
  it.each(ADMIN_CODES)('adminError_%s_returnsTheCode', (code) => {
    const error = GraphqlError.fromErrors([{ message: 'raw', extensions: { errorCode: code } }]);

    expect(errorCodeOf(error)).toBe(code);
  });

  it('includes them in KnownErrorCode', () => {
    expectTypeOf<AdminErrorCode>().toEqualTypeOf<(typeof ADMIN_CODES)[number]>();
    expectTypeOf<AdminErrorCode>().toExtend<KnownErrorCode>();
  });

  it('still answers undefined for a code nobody knows', () => {
    const error = GraphqlError.fromErrors([{ message: 'raw', extensions: { errorCode: 'nope' } }]);

    expect(errorCodeOf(error)).toBeUndefined();
  });
});
