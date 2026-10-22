import { describe, expect, it, vi } from 'vitest';
import { GraphqlClient } from '../../src/api/GraphqlClient';
import { ResponseCache } from '../../src/api/ResponseCache';

function answer(data: unknown = { x: 1 }): Response {
  return new Response(JSON.stringify({ data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function setup(url = '/graphql/', cache?: ResponseCache) {
  const fetchFn = vi.fn(async () => answer());
  const client = new GraphqlClient({ url, fetchFn, cache });
  const requestedUrl = (call = 0): string => String((fetchFn.mock.calls[call] as unknown[])[0]);
  return { client, fetchFn, requestedUrl };
}

describe('GraphqlClient endpoint params (?lang=, ?shp=)', () => {
  it('request_langProvided_appendsLang', async () => {
    const { client, requestedUrl } = setup();
    client.setEndpointParamsProvider(() => ({ lang: 0 }));

    await client.execute('query { x }');

    expect(requestedUrl()).toBe('/graphql/?lang=0');
  });

  it('request_shopIdProvided_appendsShp', async () => {
    const { client, requestedUrl } = setup();
    client.setEndpointParamsProvider(() => ({ shp: 2 }));

    await client.execute('query { x }');

    expect(requestedUrl()).toBe('/graphql/?shp=2');
  });

  it('request_langAndShopIdProvided_appendsBoth', async () => {
    const { client, requestedUrl } = setup();
    client.setEndpointParamsProvider(() => ({ lang: 1, shp: 2 }));

    await client.execute('query { x }');

    expect(requestedUrl()).toBe('/graphql/?shp=2&lang=1');
  });

  it('request_noProvider_endpointUnchanged', async () => {
    const { client, requestedUrl } = setup();

    await client.execute('query { x }');

    expect(requestedUrl()).toBe('/graphql/');
  });

  it('request_providerReturnsNothing_endpointUnchanged', async () => {
    const { client, requestedUrl } = setup();
    client.setEndpointParamsProvider(() => ({}));

    await client.execute('query { x }');

    expect(requestedUrl()).toBe('/graphql/');
  });

  it('request_endpointHasQuery_appendsWithAmpersand', async () => {
    const { client, requestedUrl } = setup('https://shop.test/graphql/?cl=x');
    client.setEndpointParamsProvider(() => ({ lang: 1 }));

    await client.execute('query { x }');

    expect(requestedUrl()).toBe('https://shop.test/graphql/?cl=x&lang=1');
  });

  it('request_providerAnswersPerRequest_followsTheCurrentValue', async () => {
    const { client, requestedUrl } = setup();
    let lang = 0;
    client.setEndpointParamsProvider(() => ({ lang }));

    await client.execute('query { x }');
    lang = 1;
    await client.execute('query { x }');

    expect([requestedUrl(0), requestedUrl(1)]).toEqual(['/graphql/?lang=0', '/graphql/?lang=1']);
  });

  it('request_acceptLanguageProvided_stillSentBesideTheParams', async () => {
    const { client, fetchFn } = setup();
    client.setLanguageProvider(() => 'de');
    client.setEndpointParamsProvider(() => ({ lang: 0 }));

    await client.execute('query { x }');

    const init = (fetchFn.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(init.headers['Accept-Language']).toBe('de');
  });

  it('cacheKey_differentFinalUrl_isADifferentEntry', async () => {
    const { client, fetchFn } = setup('/graphql/', new ResponseCache());
    let lang = 0;
    client.setEndpointParamsProvider(() => ({ lang }));
    const read = (): Promise<unknown> => client.execute('query { x }', {}, { cacheTtlMs: 60_000 });

    await read();
    await read(); // same URL: served from memory
    lang = 1;
    await read(); // same query, other language id: must hit the network

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
