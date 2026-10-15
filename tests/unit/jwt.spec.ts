import { describe, expect, it } from 'vitest';
import { decodeJwtPayload, isJwtExpired } from '../../src/auth/jwt';
import { expiresIn, fakeJwt } from '../helpers/jwt';

describe('jwt', () => {
  it('decodes the payload with the graphql-base claims', () => {
    const token = fakeJwt({
      exp: 123,
      username: 'user@oxid-esales.com',
      useranonymous: false,
      shopid: 1,
    });

    const payload = decodeJwtPayload(token);

    expect(payload?.username).toBe('user@oxid-esales.com');
    expect(payload?.useranonymous).toBe(false);
    expect(payload?.shopid).toBe(1);
  });

  it('returns null for malformed tokens', () => {
    expect(decodeJwtPayload('not-a-jwt')).toBeNull();
    expect(decodeJwtPayload('a.%%%.c')).toBeNull();
  });

  it('treats a future exp as valid and a past exp as expired', () => {
    expect(isJwtExpired(fakeJwt({ exp: expiresIn(3600) }))).toBe(false);
    expect(isJwtExpired(fakeJwt({ exp: expiresIn(-10) }))).toBe(true);
  });

  it('applies the clock skew and treats missing exp as expired', () => {
    expect(isJwtExpired(fakeJwt({ exp: expiresIn(10) }), 30)).toBe(true);
    expect(isJwtExpired(fakeJwt({ username: 'x' }))).toBe(true);
  });
});
