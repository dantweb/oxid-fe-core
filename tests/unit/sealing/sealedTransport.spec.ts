import { describe, expect, it, vi } from 'vitest';
import { GraphqlClient } from '../../../src/api/GraphqlClient';
import { ShopDouble, type Envelope } from '../../helpers/sealedChannelShop';
import { needsSealedAnswers, openAnswers } from '../../../src/sealing/sealedTransport';
import { SealedChannel } from '../../../src/sealing/sealedChannel';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

interface Call {
  query: string;
  variables: Record<string, unknown>;
  headers: Record<string, string>;
  body: string;
}

/**
 * A fetch whose "shop" is the Node double: it answers the handshake, and hands every other request to `handler`
 * (which may seal answer fields with the double).
 */
function shopFetch(
  shop: ShopDouble,
  handler: (call: Call, shop: ShopDouble) => unknown,
): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
    const body = String(init.body);
    const parsed = JSON.parse(body) as { query: string; variables?: Record<string, unknown> };
    const call: Call = {
      query: parsed.query,
      variables: parsed.variables ?? {},
      headers: (init.headers ?? {}) as Record<string, string>,
      body,
    };
    calls.push(call);
    if (call.query.includes('sealedChannelOpen')) {
      return json({
        data: {
          sealedChannelOpen: shop.open(
            String(call.variables.clientPublicKey),
            String(call.variables.app),
          ),
        },
      });
    }
    return json(handler(call, shop) as object);
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

function clientFor(fetchFn: typeof fetch) {
  const client = new GraphqlClient({ url: '/graphql/', fetchFn });
  client.setSealing(
    new SealedChannel({ execute: (q, v, o) => client.execute(q, v, o) }, { app: 'admin' }),
  );
  return client;
}

const isHandshake = (call: Call) => call.query.includes('sealedChannelOpen');

describe('needsSealedAnswers', () => {
  it('is true for a document that selects a sealed twin field', () => {
    expect(needsSealedAnswers('query { adminCustomer { customer { sealedPii { v ct } } } }')).toBe(
      true,
    );
    expect(needsSealedAnswers('{ a { sealedUrl{ v } } }')).toBe(true);
  });

  it('is false for the others, also for a field that merely contains the word', () => {
    expect(needsSealedAnswers('query { adminCustomer { customer { email } } }')).toBe(false);
    expect(
      needsSealedAnswers(
        'mutation($sealedPassword: SealedValueInput!) { adminLogin(sealedPassword: $sealedPassword) { status } }',
      ),
    ).toBe(false);
  });
});

describe('openAnswers', () => {
  it('merges a sealed object into its parent and removes the sealed field', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(
      {
        execute: async (_q: string, v?: Record<string, unknown>) => ({
          sealedChannelOpen: shop.open(String(v?.clientPublicKey), 'admin'),
        }),
      } as never,
      { app: 'admin' },
    );

    const data = await channel.run(async (request) => {
      const [id, counter] = request.answerHeaders()['X-Sealed-Channel'].split('.');
      const n = Number(counter);
      const data: Record<string, unknown> = {
        adminCustomers: {
          items: [
            {
              id: 'a',
              sealedPii: shop.seal(
                id,
                n,
                'adminCustomers.items.0.sealedPii',
                JSON.stringify({ email: 'a@x.y', phone: '1' }),
              ),
            },
            {
              id: 'b',
              sealedPii: shop.seal(
                id,
                n,
                'adminCustomers.items.1.sealedPii',
                JSON.stringify({ email: 'b@x.y', phone: '2' }),
              ),
            },
          ],
          totalCount: 2,
        },
      };
      await openAnswers(request, data);
      return data;
    });

    expect(data).toEqual({
      adminCustomers: {
        items: [
          { id: 'a', email: 'a@x.y', phone: '1' },
          { id: 'b', email: 'b@x.y', phone: '2' },
        ],
        totalCount: 2,
      },
    });
  });

  it('puts a sealed scalar or list under the name without the prefix', async () => {
    const shop = new ShopDouble();
    const channel = new SealedChannel(
      {
        execute: async (_q: string, v?: Record<string, unknown>) => ({
          sealedChannelOpen: shop.open(String(v?.clientPublicKey), 'admin'),
        }),
      } as never,
      { app: 'admin' },
    );

    const data = await channel.run(async (request) => {
      const [id, counter] = request.answerHeaders()['X-Sealed-Channel'].split('.');
      const n = Number(counter);
      const data: Record<string, unknown> = {
        adminJobFileIssue: {
          file: {
            fileName: 'x.csv',
            sealedUrl: shop.seal(
              id,
              n,
              'adminJobFileIssue.file.sealedUrl',
              JSON.stringify('widget.php?x=1'),
            ),
          },
        },
        adminMfaEnrolConfirm: {
          sealedRecoveryCodes: shop.seal(
            id,
            n,
            'adminMfaEnrolConfirm.sealedRecoveryCodes',
            JSON.stringify(['a', 'b']),
          ),
        },
      };
      await openAnswers(request, data);
      return data;
    });

    expect(data).toEqual({
      adminJobFileIssue: { file: { fileName: 'x.csv', url: 'widget.php?x=1' } },
      adminMfaEnrolConfirm: { recoveryCodes: ['a', 'b'] },
    });
  });
});

describe('AdminGraphqlClient with a sealed channel', () => {
  const LOGIN =
    'mutation adminLogin($username: String!, $sealedPassword: SealedValueInput!) { adminLogin(username: $username, sealedPassword: $sealedPassword) { status } }';

  it('seals the named argument, never sends it plain, and sends no bearer token for the handshake', async () => {
    const shop = new ShopDouble();
    let opened = '';
    const { fetchFn, calls } = shopFetch(shop, (call, s) => {
      opened = s.unseal(call.variables.sealedPassword as Envelope, 'adminLogin.password');
      return { data: { adminLogin: { status: 'AUTHENTICATED' } } };
    });
    const client = clientFor(fetchFn);

    const data = await client.execute<{ adminLogin: { status: string } }>(
      LOGIN,
      { username: 'admin@example.org', password: 'correct horse' },
      {
        sealedArguments: { password: { path: 'adminLogin.password', into: 'sealedPassword' } },
        omitToken: true,
      },
    );

    expect(data.adminLogin.status).toBe('AUTHENTICATED');
    expect(opened).toBe('correct horse');
    const login = calls.find((call) => !isHandshake(call)) as Call;
    expect(login.body).not.toContain('correct horse');
    expect(login.variables).not.toHaveProperty('password');
    expect(login.variables.sealedPassword).toMatchObject({ v: 2, counter: 1 });
  });

  it('asks for sealed answers when the document selects a sealed field, and returns the plain shape', async () => {
    const shop = new ShopDouble();
    const { fetchFn, calls } = shopFetch(shop, (call, s) => {
      const [id, counter] = call.headers['X-Sealed-Channel'].split('.');
      s.claim(id, Number(counter));
      return {
        data: {
          adminCustomer: {
            customer: {
              id: 'c1',
              sealedPii: s.seal(
                id,
                Number(counter),
                'adminCustomer.customer.sealedPii',
                JSON.stringify({ email: 'jane@example.org' }),
              ),
            },
          },
        },
      };
    });
    const client = clientFor(fetchFn);

    const data = await client.execute<{
      adminCustomer: { customer: { id: string; email: string } };
    }>(
      'query { adminCustomer(customerId: "c1") { customer { id sealedPii { v channelId counter iv ct } } } }',
    );

    expect(data.adminCustomer.customer).toEqual({ id: 'c1', email: 'jane@example.org' });
    const read = calls.find((call) => !isHandshake(call)) as Call;
    expect(read.headers['X-Sealed-Channel']).toMatch(/\.1$/);
    expect(read.body).not.toContain('jane@example.org');
  });

  it('does not touch a document without sealed fields or arguments (no handshake)', async () => {
    const shop = new ShopDouble();
    const { fetchFn, calls } = shopFetch(shop, () => ({ data: { adminMe: { id: 'x' } } }));

    await clientFor(fetchFn).execute('query { adminMe { id } }');

    expect(calls).toHaveLength(1);
    expect(calls[0].headers).not.toHaveProperty('X-Sealed-Channel');
  });

  it('seals again for the retry after a rejected token: a counter is never reused', async () => {
    const shop = new ShopDouble();
    const counters: number[] = [];
    let attempt = 0;
    const { fetchFn } = shopFetch(shop, (call, s) => {
      const [id, counter] = call.headers['X-Sealed-Channel'].split('.');
      counters.push(Number(counter));
      attempt += 1;
      if (attempt === 1) {
        return { errors: [{ message: 'The access token is invalid', extensions: {} }] };
      }
      s.claim(id, Number(counter));
      return {
        data: {
          adminMe: {
            sealedPii: s.seal(id, Number(counter), 'adminMe.sealedPii', JSON.stringify({ a: 1 })),
          },
        },
      };
    });
    const client = clientFor(fetchFn);
    client.setTokenProvider(() => 'a.b.c');
    client.setTokenRejectedHandler(() => undefined);

    const data = await client.execute(
      'query { adminMe { sealedPii { v channelId counter iv ct } } }',
    );

    expect(data).toEqual({ adminMe: { a: 1 } });
    expect(counters).toEqual([1, 2]);
  });

  it('re-opens the channel once when the shop says it expired, and repeats with fresh seals', async () => {
    const shop = new ShopDouble();
    let attempt = 0;
    const { fetchFn, calls } = shopFetch(shop, (call, s) => {
      attempt += 1;
      if (attempt === 1) {
        s.channels.clear();
        return {
          errors: [{ message: 'expired', extensions: { errorCode: 'sealed_channel_expired' } }],
        };
      }
      s.unseal(call.variables.sealedPassword as Envelope, 'adminLogin.password');
      return { data: { adminLogin: { status: 'AUTHENTICATED' } } };
    });
    const client = clientFor(fetchFn);

    const data = await client.execute<{ adminLogin: { status: string } }>(
      LOGIN,
      { username: 'a', password: 'pw' },
      {
        sealedArguments: { password: { path: 'adminLogin.password', into: 'sealedPassword' } },
        omitToken: true,
      },
    );

    expect(data.adminLogin.status).toBe('AUTHENTICATED');
    expect(calls.filter(isHandshake)).toHaveLength(2);
  });
});
