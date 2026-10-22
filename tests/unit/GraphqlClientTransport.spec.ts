import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GraphqlClient } from '../../src/api/GraphqlClient';
import { ERROR_CODE_NETWORK, GraphqlError } from '../../src/api/GraphqlError';
import { ResponseCache } from '../../src/api/ResponseCache';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A fetch that never answers on its own and rejects the way fetch does when its signal aborts. */
function hangingFetch() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
    return new Promise<Response>((_resolve, reject) => {
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
      init?.signal?.addEventListener('abort', () => {
        reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
      });
    });
  });
}

function headersOf(fetchFn: ReturnType<typeof vi.fn>, call = 0): Record<string, string> {
  return fetchFn.mock.calls[call][1].headers as Record<string, string>;
}

describe('GraphqlClient per-call headers', () => {
  it('sends them next to the client headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn, headers: { 'X-Shop': '1' } });

    await client.execute('query { x }', undefined, { headers: { 'X-OXID-Admin': '1' } });

    expect(headersOf(fetchFn)).toMatchObject({ 'X-Shop': '1', 'X-OXID-Admin': '1' });
  });

  it('does not let them replace the bearer token', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn });
    client.setTokenProvider(() => 'real');

    await client.execute('query { x }', undefined, { headers: { Authorization: 'Bearer fake' } });

    expect(headersOf(fetchFn)['Authorization']).toBe('Bearer real');
  });

  it('are sent again on the retry after a rejected token', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ errors: [{ message: 'x', extensions: { errorCode: 'invalid_token' } }] }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn });
    client.setTokenProvider(() => 'stale');
    client.setTokenRejectedHandler(() => client.setTokenProvider(() => null));

    await client.execute('query { x }', undefined, { headers: { 'X-OXID-Admin': '1' } });

    expect(headersOf(fetchFn, 1)['X-OXID-Admin']).toBe('1');
  });

  it('keep cached reads with different headers apart', async () => {
    const fetchFn = vi.fn().mockImplementation(async () => jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn, cache: new ResponseCache() });

    await client.execute('query { x }', undefined, { cacheTtlMs: 1000, headers: { A: '1' } });
    await client.execute('query { x }', undefined, { cacheTtlMs: 1000, headers: { A: '2' } });
    await client.execute('query { x }', undefined, { cacheTtlMs: 1000, headers: { A: '2' } });

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});

describe('GraphqlClient signal and timeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('passes no signal when none is asked for (0.10.0 request shape)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn });

    await client.execute('query { x }');

    expect(fetchFn.mock.calls[0][1]).not.toHaveProperty('signal');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('aborts the request when the caller aborts, and rethrows the abort', async () => {
    const fetchFn = hangingFetch();
    const client = new GraphqlClient({ url: '/g', fetchFn });
    const controller = new AbortController();

    const pending = client.execute('query { x }', undefined, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await expect(pending).rejects.not.toBeInstanceOf(GraphqlError);
  });

  it('refuses at once with a signal that is already aborted', async () => {
    const fetchFn = hangingFetch();
    const client = new GraphqlClient({ url: '/g', fetchFn });
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.execute('query { x }', undefined, { signal: controller.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('turns a timeout into a network_error GraphqlError', async () => {
    const fetchFn = hangingFetch();
    const client = new GraphqlClient({ url: '/g', fetchFn });

    const pending = client.execute('query { x }', undefined, { timeoutMs: 5000 });
    const assertion = expect(pending).rejects.toMatchObject({ errorCode: ERROR_CODE_NETWORK });
    await vi.advanceTimersByTimeAsync(5000);

    await assertion;
    await expect(pending).rejects.toThrow(/timed out after 5000 ms/);
  });

  it('does not time out an answer that arrives in time and leaves no timer behind', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn });

    await expect(client.execute('query { x }', undefined, { timeoutMs: 5000 })).resolves.toEqual({
      x: 1,
    });

    expect(vi.getTimerCount()).toBe(0);
  });

  it('removes its listener from a long-lived caller signal', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn });
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, 'removeEventListener');

    await client.execute('query { x }', undefined, { signal: controller.signal });

    expect(removed).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});

describe('GraphqlClient multipart upload', () => {
  const UPLOAD = 'mutation up($file: Upload!) { upload(file: $file) }';

  it('sends a File variable as multipart per the GraphQL multipart request spec', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { upload: true } }));
    const client = new GraphqlClient({ url: '/g', fetchFn, headers: { 'X-Shop': '1' } });
    client.setTokenProvider(() => 'jwt');
    const upload = new File(['hello'], 'a.txt', { type: 'text/plain' });

    const data = await client.execute(UPLOAD, { file: upload });

    expect(data).toEqual({ upload: true });
    const init = fetchFn.mock.calls[0][1];
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(JSON.parse(form.get('operations') as string)).toEqual({
      query: UPLOAD,
      variables: { file: null },
    });
    expect(JSON.parse(form.get('map') as string)).toEqual({ '0': ['variables.file'] });
    expect((form.get('0') as File).name).toBe('a.txt');
  });

  it('leaves the Content-Type to the runtime (it carries the boundary) and keeps the other headers', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { upload: true } }));
    const client = new GraphqlClient({
      url: '/g',
      fetchFn,
      headers: { 'content-type': 'application/json', 'X-Shop': '1' },
    });
    client.setTokenProvider(() => 'jwt');

    await client.execute(UPLOAD, { file: new Blob(['x']) }, { headers: { 'X-OXID-Admin': '1' } });

    const headers = headersOf(fetchFn);
    expect(Object.keys(headers).map((name) => name.toLowerCase())).not.toContain('content-type');
    expect(headers).toMatchObject({
      'X-Shop': '1',
      'X-OXID-Admin': '1',
      Authorization: 'Bearer jwt',
    });
  });

  it('keeps sending JSON when the variables hold no file', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: { x: 1 } }));
    const client = new GraphqlClient({ url: '/g', fetchFn });

    await client.execute('mutation { x }', { a: 1 });

    expect(headersOf(fetchFn)['Content-Type']).toBe('application/json');
    expect(fetchFn.mock.calls[0][1].body).toBe(
      JSON.stringify({ query: 'mutation { x }', variables: { a: 1 } }),
    );
  });
});
