/**
 * Claims graphql-base writes into its JWTs
 * (OxidEsales\GraphQL\Base\Service\Token CLAIM_* constants).
 */
export interface OxidJwtPayload {
  exp?: number;
  shopid?: number;
  username?: string;
  userid?: string;
  useranonymous?: boolean;
  tokenid?: string;
  [key: string]: unknown;
}

export function decodeJwtPayload(token: string): OxidJwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeBase64(base64);
    return JSON.parse(json) as OxidJwtPayload;
  } catch {
    return null;
  }
}

export function isJwtExpired(
  token: string,
  skewSeconds = 30,
  now: () => number = Date.now,
): boolean {
  const payload = decodeJwtPayload(token);
  if (!payload?.exp) {
    return true;
  }
  return payload.exp * 1000 <= now() + skewSeconds * 1000;
}

function decodeBase64(base64: string): string {
  if (typeof atob === 'function') {
    // JWT payloads are ASCII JSON with possibly escaped unicode; decode bytes → utf-8
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  return Buffer.from(base64, 'base64').toString('utf-8');
}
