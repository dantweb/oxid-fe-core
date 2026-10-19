import type { GraphqlClient } from '../api/GraphqlClient';
import { fromBase64Url, toBase64Url } from '../utils/base64url';

/**
 * Receives a provider's public client values (Stripe publishable key, PayPal client id, …) from the
 * shop, sealed for this browser only. Protocol and threat model: oxid-fe-user docs/payments-keys.md.
 * Knows nothing about providers: it fetches and unseals, nothing else.
 */
const PAYMENT_CLIENT_CONFIG_QUERY = /* GraphQL */ `
  query paymentClientConfig($provider: String!, $clientPublicKey: String!) {
    paymentClientConfig(provider: $provider, clientPublicKey: $clientPublicKey) {
      v
      alg
      serverPublicKey
      salt
      iv
      issuedAt
      ciphertext
    }
  }
`;

const VERSION = 1;
const ALGORITHM = 'ECDH-P256+HKDF-SHA256+A256GCM';
const RAW_P256_POINT_BYTES = 65;
/** A sealed answer older (or newer) than this against the browser's clock is a replay. */
const MAX_AGE_SECONDS = 120;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;

export type SealedValues = Record<string, string | boolean>;

/** Any failure to obtain the values; the message never contains key material. */
export class SealedConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedConfigError';
  }
}

interface Envelope {
  v: number;
  alg: string;
  serverPublicKey: string;
  salt: string;
  iv: string;
  issuedAt: number;
  ciphertext: string;
}

export interface BrowserKeyPair {
  privateKey: CryptoKey;
  /** the raw uncompressed point, base64url */
  publicKeyRaw: string;
}

export interface SealedConfigOptions {
  /** `tokenid` claim of the session token; the answer is bound to it. */
  tokenId?: string;
  /** Injectable for tests. */
  now?: () => number;
  /** `null` simulates a browser without WebCrypto. */
  subtle?: SubtleCrypto | null;
  /** Injectable for tests (a fixed pair); default: a fresh, non-extractable pair per call. */
  keyPair?: () => Promise<BrowserKeyPair>;
}

export async function fetchSealedConfig(
  client: Pick<GraphqlClient, 'execute'>,
  provider: string,
  options: SealedConfigOptions = {},
): Promise<SealedValues> {
  const subtle = options.subtle === undefined ? globalThis.crypto?.subtle : options.subtle;
  if (!subtle) {
    throw new SealedConfigError('WebCrypto is not available');
  }
  const tokenId = options.tokenId ?? '';
  const now = options.now ?? Date.now;
  const keyPair = await (options.keyPair ?? (() => generateKeyPair(subtle)))();

  const envelope = await requestEnvelope(client, provider, keyPair.publicKeyRaw);
  checkEnvelope(envelope, now());

  try {
    const aad = new TextEncoder().encode(
      ['oxid-pcc', `v${envelope.v}`, provider, envelope.issuedAt, tokenId].join('|'),
    );
    const key = await deriveKey(subtle, keyPair.privateKey, envelope, aad);
    const plaintext = await subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(envelope.iv), additionalData: aad, tagLength: 128 },
      key,
      fromBase64Url(envelope.ciphertext),
    );
    return parseValues(new TextDecoder().decode(plaintext));
  } catch (error) {
    throw error instanceof SealedConfigError
      ? error
      : new SealedConfigError('The sealed answer could not be opened');
  }
}

async function generateKeyPair(subtle: SubtleCrypto): Promise<BrowserKeyPair> {
  const pair = await subtle.generateKey(CURVE, false, ['deriveBits']);
  const raw = await subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyRaw: toBase64Url(new Uint8Array(raw)) };
}

async function requestEnvelope(
  client: Pick<GraphqlClient, 'execute'>,
  provider: string,
  clientPublicKey: string,
): Promise<Envelope> {
  try {
    const data = await client.execute<{ paymentClientConfig: Envelope }>(
      PAYMENT_CLIENT_CONFIG_QUERY,
      { provider, clientPublicKey },
    );
    return data.paymentClientConfig;
  } catch {
    throw new SealedConfigError('The shop did not provide the payment configuration');
  }
}

function checkEnvelope(envelope: Envelope, nowMs: number): void {
  if (envelope.v !== VERSION || envelope.alg !== ALGORITHM) {
    throw new SealedConfigError('Unsupported envelope');
  }
  if (
    !Number.isInteger(envelope.issuedAt) ||
    Math.abs(nowMs / 1000 - envelope.issuedAt) > MAX_AGE_SECONDS
  ) {
    throw new SealedConfigError('The sealed answer is outside its validity window');
  }
  if (fromBase64Url(envelope.serverPublicKey).length !== RAW_P256_POINT_BYTES) {
    throw new SealedConfigError('Unsupported envelope');
  }
}

async function deriveKey(
  subtle: SubtleCrypto,
  privateKey: CryptoKey,
  envelope: Envelope,
  aad: Uint8Array,
): Promise<CryptoKey> {
  const serverKey = await subtle.importKey(
    'raw',
    fromBase64Url(envelope.serverPublicKey),
    CURVE,
    false,
    [],
  );
  const secret = await subtle.deriveBits({ name: 'ECDH', public: serverKey }, privateKey, 256);
  const material = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: fromBase64Url(envelope.salt), info: aad },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
}

function parseValues(json: string): SealedValues {
  const parsed: unknown = JSON.parse(json);
  const isFlat =
    typeof parsed === 'object' &&
    parsed !== null &&
    !Array.isArray(parsed) &&
    Object.values(parsed).every((value) => typeof value === 'string' || typeof value === 'boolean');
  if (!isFlat) {
    throw new SealedConfigError('Unexpected payment configuration shape');
  }
  return parsed as SealedValues;
}
