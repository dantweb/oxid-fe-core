import type { GraphqlClient } from '../api/GraphqlClient';
import { GraphqlError } from '../api/GraphqlError';
import { fromBase64Url, toBase64Url } from '../utils/base64url';

/**
 * The browser side of the sealed channel (envelope v2, server module oxid-sealed-channel, spec
 * docs/envelope-v2.md there). One ECDH P-256 key pair per channel, the private key non-extractable and in memory only;
 * HKDF-SHA256 derives one AES-256-GCM key per direction; every value is sealed with a fresh random 96-bit IV and an AAD
 * that binds channel, place (path), counter and direction. Standard WebCrypto only.
 *
 * Use `run(work)`: it opens the channel when needed (once per session), serialises sealed requests so the counters
 * arrive in order, and re-opens once when the shop answers `sealed_channel_expired`.
 */
export const SEALED_CHANNEL_HEADER = 'X-Sealed-Channel';
export const ERROR_CODE_CHANNEL_EXPIRED = 'sealed_channel_expired';

const OPEN_MUTATION = /* GraphQL */ `
  mutation sealedChannelOpen($clientPublicKey: String!, $app: String!) {
    sealedChannelOpen(clientPublicKey: $clientPublicKey, app: $app) {
      channelId
      serverPublicKey
      salt
      binding
      app
      expiresAt
    }
  }
`;

const VERSION = 2;
const RAW_P256_POINT_BYTES = 65;
const KEY_BYTES = 32;
const IV_BYTES = 12;
const CURVE = { name: 'ECDH', namedCurve: 'P-256' } as const;
/** Opens a new channel this long before the old one ends, so a request never races the expiry. */
const EXPIRY_MARGIN_MS = 30_000;

/** The envelope as it travels, both as a `SealedValueInput` argument and as a `SealedValue` field. */
export interface SealedValue {
  v: number;
  channelId: string;
  counter: number;
  iv: string;
  ct: string;
}

/** Any failure of the channel; the message never contains key material or a value. */
export class SealedChannelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SealedChannelError';
  }
}

export interface BrowserKeyPair {
  privateKey: CryptoKey;
  /** the raw uncompressed point, base64url */
  publicKeyRaw: string;
}

export interface SealedChannelOptions {
  /** Short label bound into the keys: "admin", "shop". */
  app: string;
  /**
   * Bind the channel to the bearer token of the handshake. Off by default: tokens rotate (refresh), an anonymous
   * channel keeps working across the rotation, and the channel key is the capability.
   */
  bindToToken?: boolean;
  /** Injectable for tests. */
  now?: () => number;
  /** `null` simulates a browser without WebCrypto. */
  subtle?: SubtleCrypto | null;
  /** Injectable for tests (a fixed pair); default: a fresh, non-extractable pair per channel. */
  keyPair?: () => Promise<BrowserKeyPair>;
  /** Injectable for tests (known-answer vector); default: crypto.getRandomValues. */
  randomIv?: () => Uint8Array;
}

interface Handshake {
  channelId: string;
  serverPublicKey: string;
  salt: string;
  binding: string;
  app: string;
  expiresAt: number;
}

interface Session {
  channelId: string;
  expiresAtMs: number;
  toServer: CryptoKey;
  fromServer: CryptoKey;
  counter: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

export class SealedChannel {
  private session: Session | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly subtle: SubtleCrypto | null;

  constructor(
    private readonly client: Pick<GraphqlClient, 'execute'>,
    private readonly options: SealedChannelOptions,
  ) {
    this.subtle =
      options.subtle === undefined ? (globalThis.crypto?.subtle ?? null) : options.subtle;
  }

  /**
   * Runs one sealed request: `work` seals its arguments with `request.seal`, asks for sealed answers with
   * `request.answerHeaders()`, sends the request and opens the answer with `request.unseal`. Requests run one at a
   * time. When the shop answers `sealed_channel_expired`, the channel is opened anew and `work` runs once more.
   */
  run<T>(work: (request: SealedRequest) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => this.runOnce(work));
    this.queue = result.catch(() => undefined);
    return result;
  }

  private async runOnce<T>(work: (request: SealedRequest) => Promise<T>): Promise<T> {
    try {
      return await work(await this.requestOnLiveChannel());
    } catch (error) {
      if (!isExpired(error)) {
        throw error;
      }
      this.session = null;
      return work(await this.requestOnLiveChannel());
    }
  }

  private async requestOnLiveChannel(): Promise<SealedRequest> {
    const now = (this.options.now ?? Date.now)();
    if (!this.session || this.session.expiresAtMs - EXPIRY_MARGIN_MS <= now) {
      this.session = await this.open();
    }
    return new SealedRequest(this.session, this.requireSubtle(), this.options.randomIv ?? randomIv);
  }

  private requireSubtle(): SubtleCrypto {
    if (!this.subtle) {
      throw new SealedChannelError('WebCrypto is not available');
    }
    return this.subtle;
  }

  private async open(): Promise<Session> {
    const subtle = this.requireSubtle();
    const keyPair = await (this.options.keyPair ?? (() => generateKeyPair(subtle)))();
    const handshake = await this.handshake(keyPair.publicKeyRaw);
    try {
      return await this.derive(subtle, keyPair.privateKey, handshake);
    } catch {
      throw new SealedChannelError('The sealed channel could not be established');
    }
  }

  private async handshake(clientPublicKey: string): Promise<Handshake> {
    try {
      const data = await this.client.execute<{ sealedChannelOpen: Handshake }>(
        OPEN_MUTATION,
        { clientPublicKey, app: this.options.app },
        { omitToken: this.options.bindToToken !== true },
      );
      return data.sealedChannelOpen;
    } catch (error) {
      if (error instanceof GraphqlError) {
        throw new SealedChannelError(`The shop refused the sealed channel (${error.errorCode})`);
      }
      throw new SealedChannelError('The shop did not open a sealed channel');
    }
  }

  private async derive(
    subtle: SubtleCrypto,
    privateKey: CryptoKey,
    handshake: Handshake,
  ): Promise<Session> {
    if (fromBase64Url(handshake.serverPublicKey).length !== RAW_P256_POINT_BYTES) {
      throw new Error('bad server key');
    }
    const serverKey = await subtle.importKey(
      'raw',
      fromBase64Url(handshake.serverPublicKey),
      CURVE,
      false,
      [],
    );
    const secret = await subtle.deriveBits({ name: 'ECDH', public: serverKey }, privateKey, 256);
    const material = await subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
    const info = encoder.encode(
      `oxid-sc|v${VERSION}|${handshake.channelId}|${handshake.binding}|${handshake.app}`,
    );
    const bits = new Uint8Array(
      await subtle.deriveBits(
        { name: 'HKDF', hash: 'SHA-256', salt: fromBase64Url(handshake.salt), info },
        material,
        2 * KEY_BYTES * 8,
      ),
    );
    try {
      return {
        channelId: handshake.channelId,
        expiresAtMs: handshake.expiresAt * 1000,
        toServer: await importAesKey(subtle, bits.slice(0, KEY_BYTES), 'encrypt'),
        fromServer: await importAesKey(subtle, bits.slice(KEY_BYTES), 'decrypt'),
        counter: 0,
      };
    } finally {
      // the raw bytes are only needed to build the two non-extractable keys
      bits.fill(0);
    }
  }
}

/** The view of one request on the channel: its counters, its seals, its answers. */
export class SealedRequest {
  private answerCounter: number | null = null;

  constructor(
    private readonly session: Session,
    private readonly subtle: SubtleCrypto,
    private readonly newIv: () => Uint8Array,
  ) {}

  /**
   * Seals the value of an argument. $path names its place, e.g. "adminLogin.password"; the shop opens it with the same
   * path. The counters of a request are taken in the order the shop opens its values: arguments in declaration order,
   * the answer header last.
   */
  seal(path: string, plaintext: string): Promise<SealedValue> {
    this.session.counter += 1;
    return this.sealAt(path, plaintext, this.session.counter);
  }

  /** Seals with a given counter (the known-answer vector; everything else uses `seal`). */
  async sealAt(path: string, plaintext: string, counter: number): Promise<SealedValue> {
    const iv = this.newIv();
    const box = await this.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv,
        additionalData: aad('req', this.session.channelId, path, counter),
        tagLength: 128,
      },
      this.session.toServer,
      encoder.encode(plaintext),
    );
    return {
      v: VERSION,
      channelId: this.session.channelId,
      counter,
      iv: toBase64Url(iv),
      ct: toBase64Url(new Uint8Array(box)),
    };
  }

  /** The request header that asks the shop for sealed answers (one counter per request). */
  answerHeaders(): Record<string, string> {
    if (this.answerCounter === null) {
      this.session.counter += 1;
      this.answerCounter = this.session.counter;
    }
    return { [SEALED_CHANNEL_HEADER]: `${this.session.channelId}.${this.answerCounter}` };
  }

  /**
   * Opens a sealed field of the answer. $path is the place of the field in the response, the response keys joined by
   * dots ("adminCustomers.items.0.sealedEmail"); the envelope must belong to this request's counter.
   */
  async unseal(value: SealedValue, path: string): Promise<string> {
    if (this.answerCounter === null) {
      throw new SealedChannelError('No sealed answer was asked for');
    }
    return this.unsealAt(value, path, this.answerCounter);
  }

  /** Opens with a given request counter (the known-answer vector; everything else uses `unseal`). */
  async unsealAt(value: SealedValue, path: string, requestCounter: number): Promise<string> {
    if (
      value.v !== VERSION ||
      value.channelId !== this.session.channelId ||
      value.counter !== requestCounter
    ) {
      throw new SealedChannelError('The sealed answer does not belong to this request');
    }
    try {
      const plain = await this.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: fromBase64Url(value.iv),
          additionalData: aad('res', value.channelId, path, requestCounter),
          tagLength: 128,
        },
        this.session.fromServer,
        fromBase64Url(value.ct),
      );
      return decoder.decode(plain);
    } catch {
      throw new SealedChannelError('The sealed answer could not be opened');
    }
  }
}

function isExpired(error: unknown): boolean {
  return error instanceof GraphqlError && error.errorCode === ERROR_CODE_CHANNEL_EXPIRED;
}

function aad(direction: 'req' | 'res', channelId: string, path: string, counter: number) {
  return encoder.encode(`oxid-sc|v${VERSION}|${direction}|${channelId}|${path}|${counter}`);
}

function randomIv(): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
}

async function generateKeyPair(subtle: SubtleCrypto): Promise<BrowserKeyPair> {
  const pair = await subtle.generateKey(CURVE, false, ['deriveBits']);
  const raw = await subtle.exportKey('raw', pair.publicKey);
  return { privateKey: pair.privateKey, publicKeyRaw: toBase64Url(new Uint8Array(raw)) };
}

function importAesKey(
  subtle: SubtleCrypto,
  bytes: Uint8Array,
  usage: 'encrypt' | 'decrypt',
): Promise<CryptoKey> {
  return subtle.importKey('raw', bytes, { name: 'AES-GCM' }, false, [usage]);
}
