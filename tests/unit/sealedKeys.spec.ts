import { describe, expect, it, vi, type Mock } from 'vitest';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import type { AuthService } from '../../src/auth/AuthService';
import { createSealedKeys, sealedKeysForPlugin } from '../../src/payments/sealedKeys';
import { sealLikeTheShop } from '../helpers/sealer';
import { SealedConfigError } from '../../src/payments/sealedConfig';

const parse = (values: Record<string, string | boolean>) => ({ key: String(values.key) });

type FetchValues = (provider: string, tokenId: string) => Promise<Record<string, string | boolean>>;

function setup(fetchValues: Mock<FetchValues>, tokenId = { current: 't1' }) {
  const keys = createSealedKeys({
    provider: 'stripe',
    fetchValues: (provider) => fetchValues(provider, tokenId.current),
    tokenId: () => tokenId.current,
    parse,
  });
  return { keys, tokenId };
}

describe('createSealedKeys', () => {
  it('fetches once and serves the same values afterwards (memory only)', async () => {
    const fetchValues = vi.fn<FetchValues>(async () => ({ key: 'k1' }));
    const { keys } = setup(fetchValues);

    expect(await keys.load()).toEqual({ key: 'k1' });
    expect(await keys.load()).toEqual({ key: 'k1' });

    expect(fetchValues).toHaveBeenCalledTimes(1);
    expect(fetchValues).toHaveBeenCalledWith('stripe', 't1');
  });

  it('shares one request between concurrent callers', async () => {
    const fetchValues = vi.fn<FetchValues>(async () => ({ key: 'k1' }));
    const { keys } = setup(fetchValues);

    await Promise.all([keys.load(), keys.load()]);

    expect(fetchValues).toHaveBeenCalledTimes(1);
  });

  it('asks again when the session changed (the answer is bound to the session token)', async () => {
    const fetchValues = vi.fn<FetchValues>(async () => ({ key: 'k' }));
    const { keys, tokenId } = setup(fetchValues);

    await keys.load();
    tokenId.current = 't2';
    await keys.load();

    expect(fetchValues).toHaveBeenCalledTimes(2);
    expect(fetchValues).toHaveBeenLastCalledWith('stripe', 't2');
  });

  it('a failure flips `failed` (the plugin then uses the hosted page) and is rethrown', async () => {
    const fetchValues = vi.fn<FetchValues>(async () => Promise.reject(new SealedConfigError('no')));
    const { keys } = setup(fetchValues);
    expect(keys.failed.value).toBe(false);

    await expect(keys.load()).rejects.toBeInstanceOf(SealedConfigError);

    expect(keys.failed.value).toBe(true);
  });

  it('stays failed for the page: no retry storm against the shop', async () => {
    const fetchValues = vi.fn<FetchValues>(async () => Promise.reject(new SealedConfigError('no')));
    const { keys } = setup(fetchValues);
    await keys.load().catch(() => undefined);

    await expect(keys.load()).rejects.toBeInstanceOf(SealedConfigError);

    expect(fetchValues).toHaveBeenCalledTimes(1);
  });

  it('a payload the plugin cannot use (parse throws) also counts as failed', async () => {
    const keys = createSealedKeys({
      provider: 'paypal',
      fetchValues: async () => ({}),
      tokenId: () => undefined,
      parse: () => {
        throw new SealedConfigError('missing clientId');
      },
    });

    await expect(keys.load()).rejects.toBeInstanceOf(SealedConfigError);
    expect(keys.failed.value).toBe(true);
  });
});

describe('sealedKeysForPlugin', () => {
  it('asks the shop through the client, bound to the session token id', async () => {
    const execute = vi.fn(async (_query: string, variables?: Record<string, unknown>) => ({
      paymentClientConfig: sealLikeTheShop({
        clientPublicKey: String(variables?.clientPublicKey),
        provider: 'stripe',
        tokenId: 'sess-9',
        issuedAt: Math.floor(Date.now() / 1000),
        values: { key: 'k-live' },
      }),
    }));
    const keys = sealedKeysForPlugin(
      {
        client: { execute } as unknown as Pick<GraphqlClient, 'execute'>,
        auth: { payload: () => ({ tokenid: 'sess-9' }) } as Pick<AuthService, 'payload'>,
      },
      'stripe',
      parse,
    );

    expect(await keys.load()).toEqual({ key: 'k-live' });
  });

  it('a session without a token id is bound to the empty id', async () => {
    const execute = vi.fn(async (_query: string, variables?: Record<string, unknown>) => ({
      paymentClientConfig: sealLikeTheShop({
        clientPublicKey: String(variables?.clientPublicKey),
        provider: 'stripe',
        tokenId: '',
        issuedAt: Math.floor(Date.now() / 1000),
        values: { key: 'k' },
      }),
    }));
    const keys = sealedKeysForPlugin(
      {
        client: { execute } as unknown as Pick<GraphqlClient, 'execute'>,
        auth: { payload: () => null } as Pick<AuthService, 'payload'>,
      },
      'stripe',
      parse,
    );

    expect(await keys.load()).toEqual({ key: 'k' });
  });
});
