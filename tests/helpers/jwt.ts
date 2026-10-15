import type { OxidJwtPayload } from '../../src/auth/jwt';

/** Builds an unsigned-but-wellformed JWT for tests (signature is not verified client-side). */
export function fakeJwt(payload: OxidJwtPayload): string {
  const encode = (value: unknown): string =>
    btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${encode({ alg: 'RS512', typ: 'JWT' })}.${encode(payload)}.signature`;
}

export function expiresIn(seconds: number): number {
  return Math.floor(Date.now() / 1000) + seconds;
}
