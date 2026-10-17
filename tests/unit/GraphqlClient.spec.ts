import { describe, expect, it, vi } from 'vitest';
import { GraphqlClient } from '../../src/api/GraphqlClient';
import { ERROR_CODE_HTTP, ERROR_CODE_NETWORK, GraphqlError } from '../../src/api/GraphqlError';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('GraphqlClient', () => {
  it('posts the document and returns data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { token: 'abc' } }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    const data = await client.execute<{ token: string }>('query { token }');

    expect(data.token).toBe('abc');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('/graphql/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body).query).toBe('query { token }');
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('sends the bearer token from the token provider', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });
    client.setTokenProvider(() => 'my-jwt');

    await client.execute('query { x }');

    expect(fetchFn.mock.calls[0][1].headers['Authorization']).toBe('Bearer my-jwt');
  });

  it('sends no Authorization header without a token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    await client.execute('query { x }');

    expect(fetchFn.mock.calls[0][1].headers['Authorization']).toBeUndefined();
  });

  it('maps GraphQL errors to GraphqlError with the stable errorCode', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      jsonResponse({
        errors: [
          {
            message: 'Basket was not found',
            extensions: { errorCode: 'basket_not_found', category: 'requesterror' },
          },
        ],
      }),
    );
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    const error = await client.execute('query { x }').catch((e: unknown) => e);

    expect(error).toBeInstanceOf(GraphqlError);
    expect((error as GraphqlError).errorCode).toBe('basket_not_found');
    expect((error as GraphqlError).category).toBe('requesterror');
  });

  it('falls back to the category, then unknown, when no errorCode is present', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ errors: [{ message: 'x', extensions: { category: 'permissionerror' } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: 'x' }] }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    const byCategory = (await client.execute('q').catch((e: unknown) => e)) as GraphqlError;
    const unknown = (await client.execute('q').catch((e: unknown) => e)) as GraphqlError;

    expect(byCategory.errorCode).toBe('permissionerror');
    expect(unknown.errorCode).toBe('unknown_error');
  });

  it('throws a network error when fetch rejects', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('offline'));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    const error = (await client.execute('q').catch((e: unknown) => e)) as GraphqlError;

    expect(error.errorCode).toBe(ERROR_CODE_NETWORK);
  });

  it('throws an http error on non-JSON or data-less responses', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(new Response('<html>', { status: 500 }))
      .mockResolvedValueOnce(jsonResponse({}, 200));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });

    const notJson = (await client.execute('q').catch((e: unknown) => e)) as GraphqlError;
    const noData = (await client.execute('q').catch((e: unknown) => e)) as GraphqlError;

    expect(notJson.errorCode).toBe(ERROR_CODE_HTTP);
    expect(noData.errorCode).toBe(ERROR_CODE_HTTP);
  });

  it('runs response interceptors before throwing', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ errors: [{ message: 'nope' }] }));
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });
    const seen: unknown[] = [];
    client.addResponseInterceptor((response) => seen.push(response.errors?.[0]?.message));

    await client.execute('q').catch(() => undefined);

    expect(seen).toEqual(['nope']);
  });

  describe('content language', () => {
    it('sends the provider’s locale as Accept-Language, so the shop answers in the storefront’s language', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } })));
      const client = new GraphqlClient({ url: '/graphql/', fetchFn });
      client.setLanguageProvider(() => 'de');

      await client.execute('{ ok }');

      expect(fetchFn.mock.calls[0][1].headers['Accept-Language']).toBe('de');
    });

    it('follows the provider on every call (a language switch applies to the next request)', async () => {
      const fetchFn = vi
        .fn()
        .mockImplementation(() =>
          Promise.resolve(new Response(JSON.stringify({ data: { ok: true } }))),
        );
      const client = new GraphqlClient({ url: '/graphql/', fetchFn });
      let locale = 'de';
      client.setLanguageProvider(() => locale);

      await client.execute('{ ok }');
      locale = 'en';
      await client.execute('{ ok }');

      expect(fetchFn.mock.calls.map((call) => call[1].headers['Accept-Language'])).toEqual([
        'de',
        'en',
      ]);
    });

    it('sends no Accept-Language of its own without a provider (the browser’s applies)', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ data: { ok: true } })));
      const client = new GraphqlClient({ url: '/graphql/', fetchFn });

      await client.execute('{ ok }');

      expect(fetchFn.mock.calls[0][1].headers['Accept-Language']).toBeUndefined();
    });
  });
});
