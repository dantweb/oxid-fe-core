import { describe, expect, it, vi } from 'vitest';
import { GraphqlClient } from '../../src/api/GraphqlClient';

const ok = (data: unknown): Response => new Response(JSON.stringify({ data }), { status: 200 });
const refused = (message = 'The access token is invalid'): Response =>
  new Response(JSON.stringify({ errors: [{ message }] }), { status: 200 });

function setup(responses: Response[], token: string | null = 'stale') {
  let current = token;
  const fetchFn = vi.fn(async () => responses.shift() ?? ok({}));
  const client = new GraphqlClient({ url: '/graphql/', fetchFn });
  client.setTokenProvider(() => current);
  const onRejected = vi.fn(() => {
    current = null; // what AuthService does: drop the token
  });
  client.setTokenRejectedHandler(onRejected);
  const sentAuth = (): (string | undefined)[] =>
    fetchFn.mock.calls.map(
      (call) =>
        ((call as unknown[])[1] as RequestInit & { headers: Record<string, string> }).headers
          .Authorization,
    );
  return { client, fetchFn, onRejected, sentAuth };
}

describe('a token the shop refuses', () => {
  it('omitToken sends no Authorization even when a token is stored', async () => {
    const { client, sentAuth } = setup([ok({ token: 't' })]);

    await client.execute('query { token }', {}, { omitToken: true });

    expect(sentAuth()).toEqual([undefined]);
  });

  it('a refused query drops the token and is retried once without it', async () => {
    const { client, onRejected, sentAuth } = setup([refused(), ok({ products: [1] })]);

    const data = await client.execute('query { products }');

    expect(data).toEqual({ products: [1] });
    expect(onRejected).toHaveBeenCalledOnce();
    expect(sentAuth()).toEqual(['Bearer stale', undefined]);
  });

  it('a refused mutation is not replayed: the error is thrown', async () => {
    const { client, onRejected, fetchFn } = setup([refused()]);

    await expect(client.execute('mutation { basketAddItem { id } }')).rejects.toThrow(
      'The access token is invalid',
    );

    expect(onRejected).toHaveBeenCalledOnce();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('retries at most once: a second refusal is thrown, no loop', async () => {
    const { client, onRejected, fetchFn } = setup([refused(), refused()]);

    await expect(client.execute('query { products }')).rejects.toThrow();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(onRejected).toHaveBeenCalledOnce();
  });

  it('does nothing about a refusal when no token was sent (nothing to drop)', async () => {
    const { client, onRejected, fetchFn } = setup([refused()], null);

    await expect(client.execute('query { products }')).rejects.toThrow();

    expect(onRejected).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('leaves other errors alone', async () => {
    const { client, onRejected, fetchFn } = setup([refused('Basket not found')]);

    await expect(client.execute('query { basket }')).rejects.toThrow('Basket not found');

    expect(onRejected).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('without a handler nothing is dropped or retried', async () => {
    const fetchFn = vi.fn(async () => refused());
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });
    client.setTokenProvider(() => 'stale');

    await expect(client.execute('query { products }')).rejects.toThrow();

    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
