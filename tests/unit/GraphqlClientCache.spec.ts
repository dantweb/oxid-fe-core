import { describe, expect, it, vi } from 'vitest';
import { GraphqlClient } from '../../src/api/GraphqlClient';
import { ResponseCache } from '../../src/api/ResponseCache';

function answer(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup() {
  const fetchFn = vi.fn(async () => answer({ n: fetchFn.mock.calls.length }));
  const client = new GraphqlClient({ url: '/graphql/', fetchFn, cache: new ResponseCache() });
  return { client, fetchFn };
}

const QUERY = 'query product($id: ID!) { product(productId: $id) { id } }';

describe('GraphqlClient caching (opt-in per call)', () => {
  it('without cacheTtlMs every call goes to the network', async () => {
    const { client, fetchFn } = setup();

    await client.execute(QUERY, { id: '1' });
    await client.execute(QUERY, { id: '1' });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('with cacheTtlMs an identical read is answered once', async () => {
    const { client, fetchFn } = setup();

    const first = await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 60_000 });
    const second = await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 60_000 });

    expect(second).toEqual(first);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('different variables are different entries, whatever the key order', async () => {
    const { client, fetchFn } = setup();

    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 1000 });
    await client.execute(QUERY, { id: '2' }, { cacheTtlMs: 1000 });
    await client.execute(QUERY, { a: 1, b: 2 }, { cacheTtlMs: 1000 });
    await client.execute(QUERY, { b: 2, a: 1 }, { cacheTtlMs: 1000 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('a language switch is a miss — the shop answers per language', async () => {
    const { client, fetchFn } = setup();
    let language = 'de';
    client.setLanguageProvider(() => language);

    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 1000 });
    language = 'en';
    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 1000 });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('another user (token) never reads a cached answer of someone else', async () => {
    const { client, fetchFn } = setup();
    let token: string | null = 'alice';
    client.setTokenProvider(() => token);

    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 1000 });
    token = 'bob';
    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 1000 });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('does not cache an error answer', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'boom' }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(answer({ ok: true }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn, cache: new ResponseCache() });

    await expect(client.execute(QUERY, {}, { cacheTtlMs: 1000 })).rejects.toThrow('boom');

    expect(await client.execute(QUERY, {}, { cacheTtlMs: 1000 })).toEqual({ ok: true });
  });

  it('refuses to cache a mutation', async () => {
    const { client, fetchFn } = setup();

    await expect(
      client.execute('mutation { basketCreate { id } }', {}, { cacheTtlMs: 1000 }),
    ).rejects.toThrow(/mutation/i);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a successful mutation clears the cache, so the next read is fresh', async () => {
    const { client, fetchFn } = setup();
    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 60_000 });

    await client.execute('mutation { basketAddItem { id } }');
    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 60_000 });

    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it('a failed mutation leaves the cache alone', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(answer({ n: 1 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ errors: [{ message: 'nope' }] }), { status: 200 }),
      );
    const client = new GraphqlClient({ url: '/graphql/', fetchFn, cache: new ResponseCache() });
    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 60_000 });

    await expect(client.execute('mutation { x }')).rejects.toThrow();
    await client.execute(QUERY, { id: '1' }, { cacheTtlMs: 60_000 });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('without a cache configured cacheTtlMs is ignored (never breaks a caller)', async () => {
    const fetchFn = vi.fn(async () => answer({ n: 1 }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    await client.execute(QUERY, {}, { cacheTtlMs: 1000 });
    await client.execute(QUERY, {}, { cacheTtlMs: 1000 });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
