import { describe, expect, it, vi } from 'vitest';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import { fetchSealedConfig, SealedConfigError } from '../../src/payments/sealedConfig';
import vector from '../fixtures/sealed-config-vector.json';
import { sealLikeTheShop } from '../helpers/sealer';

const NOW = vector.issuedAt * 1000;
const subtle = globalThis.crypto.subtle;

/** A hand-made client double, typed as the real thing but keeping its mock for assertions. */
const asClient = <T>(fake: T) => fake as unknown as Pick<GraphqlClient, 'execute'> & T;

/** A client whose "shop" seals `values` for whatever public key the browser sent. */
function shopSealing(
  values: Record<string, string | boolean>,
  tweak: (envelope: Record<string, unknown>) => void = () => undefined,
  sealedFor: { provider?: string; tokenId?: string; issuedAt?: number } = {},
) {
  return asClient({
    execute: vi.fn(async (_query: string, variables?: Record<string, unknown>) => {
      const envelope = sealLikeTheShop({
        clientPublicKey: String(variables?.clientPublicKey),
        provider: sealedFor.provider ?? String(variables?.provider),
        tokenId: sealedFor.tokenId ?? 'session-1',
        issuedAt: sealedFor.issuedAt ?? vector.issuedAt,
        values,
      });
      tweak(envelope);
      return { paymentClientConfig: envelope };
    }),
  });
}

const options = { tokenId: 'session-1', now: () => NOW };

describe('fetchSealedConfig', () => {
  it('asks with a fresh public key and returns the unsealed values', async () => {
    const client = shopSealing({ publishableKey: 'pk-for-test', flag: true });

    const values = await fetchSealedConfig(client, 'stripe', options);

    expect(values).toEqual({ publishableKey: 'pk-for-test', flag: true });
    const [query, variables] = client.execute.mock.calls[0];
    expect(query).toContain('paymentClientConfig');
    expect(variables).toMatchObject({ provider: 'stripe' });
    // a raw uncompressed P-256 point, base64url: 65 bytes -> 87 characters
    expect(String(variables?.clientPublicKey)).toMatch(/^[A-Za-z0-9_-]{87}$/);
  });

  it('uses a new key pair on every call', async () => {
    const client = shopSealing({ a: 'b' });

    await fetchSealedConfig(client, 'stripe', options);
    await fetchSealedConfig(client, 'stripe', options);

    const keys = client.execute.mock.calls.map((call) => call[1]?.clientPublicKey);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('opens the shared test vector made by another implementation (Node crypto / PHP)', async () => {
    const privateKey = await subtle.importKey(
      'jwk',
      vector.clientPrivateKeyJwk as JsonWebKey,
      { name: 'ECDH', namedCurve: 'P-256' },
      false,
      ['deriveBits'],
    );
    const client = asClient({
      execute: vi.fn(async () => ({ paymentClientConfig: vector.envelope })),
    });

    const values = await fetchSealedConfig(client, vector.provider, {
      tokenId: vector.tokenId,
      now: () => NOW,
      keyPair: async () => ({ privateKey, publicKeyRaw: vector.clientPublicKey }),
    });

    expect(values).toEqual(JSON.parse(vector.plaintext));
  });

  it.each([
    ['ciphertext', (e: Record<string, unknown>) => (e.ciphertext = flip(String(e.ciphertext)))],
    ['salt', (e: Record<string, unknown>) => (e.salt = flip(String(e.salt)))],
    ['iv', (e: Record<string, unknown>) => (e.iv = flip(String(e.iv)))],
    ['issuedAt', (e: Record<string, unknown>) => (e.issuedAt = Number(e.issuedAt) + 1)],
  ])('refuses an envelope with a tampered %s', async (_field, tweak) => {
    await expect(
      fetchSealedConfig(shopSealing({ a: 'b' }, tweak), 'stripe', options),
    ).rejects.toBeInstanceOf(SealedConfigError);
  });

  it('refuses an envelope sealed for another provider', async () => {
    const client = shopSealing({ a: 'b' }, () => undefined, { provider: 'paypal' });

    await expect(fetchSealedConfig(client, 'stripe', options)).rejects.toBeInstanceOf(
      SealedConfigError,
    );
  });

  it('refuses an envelope bound to another session token', async () => {
    const client = shopSealing({ a: 'b' }, () => undefined, { tokenId: 'someone-else' });

    await expect(fetchSealedConfig(client, 'stripe', options)).rejects.toBeInstanceOf(
      SealedConfigError,
    );
  });

  it.each([[-121], [121]])(
    'refuses an envelope %i seconds off the clock (replay window)',
    async (skew) => {
      const client = shopSealing({ a: 'b' }, () => undefined, { issuedAt: vector.issuedAt + skew });

      await expect(fetchSealedConfig(client, 'stripe', options)).rejects.toBeInstanceOf(
        SealedConfigError,
      );
    },
  );

  it('accepts an envelope inside the window', async () => {
    const client = shopSealing({ a: 'b' }, () => undefined, { issuedAt: vector.issuedAt - 119 });

    expect(await fetchSealedConfig(client, 'stripe', options)).toEqual({ a: 'b' });
  });

  it.each([
    ['an unknown version', (e: Record<string, unknown>) => (e.v = 2)],
    ['an unknown algorithm', (e: Record<string, unknown>) => (e.alg = 'ROT13')],
    ['a short server key', (e: Record<string, unknown>) => (e.serverPublicKey = 'AAAA')],
  ])('refuses %s', async (_name, tweak) => {
    await expect(
      fetchSealedConfig(shopSealing({ a: 'b' }, tweak), 'stripe', options),
    ).rejects.toBeInstanceOf(SealedConfigError);
  });

  it('refuses a payload that is not a flat object of strings and booleans', async () => {
    const client = shopSealing({ nested: { a: 1 } } as never);

    await expect(fetchSealedConfig(client, 'stripe', options)).rejects.toBeInstanceOf(
      SealedConfigError,
    );
  });

  it('fails clearly without WebCrypto and never leaks key material in the message', async () => {
    const client = shopSealing({ secretish: 'zzz-value' });

    const failure = await fetchSealedConfig(client, 'stripe', {
      ...options,
      subtle: null,
    }).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SealedConfigError);
    expect(String((failure as Error).message)).not.toContain('zzz-value');
  });

  it('wraps a transport failure', async () => {
    const client = asClient({ execute: vi.fn(async () => Promise.reject(new Error('down'))) });

    await expect(fetchSealedConfig(client, 'stripe', options)).rejects.toBeInstanceOf(
      SealedConfigError,
    );
  });
});

function flip(base64url: string): string {
  const bytes = Buffer.from(base64url, 'base64url');
  bytes[0] ^= 1;
  return bytes.toString('base64url');
}
