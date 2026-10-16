import { describe, expect, it, vi } from 'vitest';
import { GraphqlError } from '../../src/api/GraphqlError';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import { createSavedListsApi } from '../../src/account/savedLists';

function clientAnswering(...answers: unknown[]): GraphqlClient {
  const execute = vi.fn();
  for (const answer of answers) {
    execute.mockResolvedValueOnce(answer);
  }
  return { execute } as unknown as GraphqlClient;
}
const calls = (client: GraphqlClient) => (client.execute as ReturnType<typeof vi.fn>).mock.calls;

describe('createSavedListsApi', () => {
  it('reads a list by its reserved title (noticelist = wish list, wishlist = gift registry)', async () => {
    const client = clientAnswering({
      customer: {
        basket: {
          id: 'b1',
          public: true,
          items: [{ id: 'i1', amount: 2, product: { id: 'p1', title: 'Kuyichi' } }],
        },
      },
    });

    const list = await createSavedListsApi(client).get('wishlist');

    expect(list).toEqual({
      id: 'b1',
      public: true,
      items: [{ id: 'i1', amount: 2, product: { id: 'p1', title: 'Kuyichi' } }],
    });
    expect(calls(client)[0][1]).toEqual({ title: 'wishlist' });
  });

  it('answers null when the customer has no such list yet', async () => {
    const client = clientAnswering({ customer: { basket: null } });

    expect(await createSavedListsApi(client).get('noticelist')).toBeNull();
  });

  it('treats the shop’s "not found" answer as no list yet, but rethrows other errors', async () => {
    const notFound = GraphqlError.fromErrors([
      {
        message: 'Basket "noticelist" not found for user "u1"',
        extensions: { category: 'requesterror' },
      },
    ]);
    const broken = GraphqlError.fromErrors([{ message: 'Internal server error' }]);
    const missing = { execute: vi.fn().mockRejectedValue(notFound) } as unknown as GraphqlClient;
    const failing = { execute: vi.fn().mockRejectedValue(broken) } as unknown as GraphqlClient;

    expect(await createSavedListsApi(missing).get('noticelist')).toBeNull();
    await expect(createSavedListsApi(failing).get('noticelist')).rejects.toBe(broken);
  });

  it('adds to an existing list without creating one', async () => {
    const client = clientAnswering(
      { customer: { basket: { id: 'b1', public: false, items: [] } } },
      { basketAddItem: { id: 'b1' } },
    );

    await createSavedListsApi(client).add('noticelist', 'p9');

    expect(calls(client)).toHaveLength(2);
    expect(calls(client)[1][1]).toEqual({ basketId: 'b1', productId: 'p9', amount: 1 });
  });

  it('creates the list on the first add', async () => {
    const client = clientAnswering(
      { customer: { basket: null } },
      { basketCreate: { id: 'new' } },
      { basketAddItem: { id: 'new' } },
    );

    await createSavedListsApi(client).add('noticelist', 'p9');

    expect(calls(client)[1][1]).toEqual({ title: 'noticelist' });
    expect(calls(client)[2][1]).toEqual({ basketId: 'new', productId: 'p9', amount: 1 });
  });

  it('removes an entry completely (its whole amount)', async () => {
    const client = clientAnswering({ basketRemoveItem: { id: 'b1' } });

    await createSavedListsApi(client).remove('b1', { id: 'i1', amount: 3 });

    expect(calls(client)[0][1]).toEqual({ basketId: 'b1', itemId: 'i1', amount: 3 });
  });

  it('switches a list public / private', async () => {
    const client = clientAnswering(
      { basketMakePublic: { id: 'b1' } },
      { basketMakePrivate: { id: 'b1' } },
    );
    const api = createSavedListsApi(client);

    await api.setPublic('b1', true);
    await api.setPublic('b1', false);

    expect(calls(client)[0][0]).toContain('basketMakePublic');
    expect(calls(client)[1][0]).toContain('basketMakePrivate');
  });

  it('counts the entries of a list (0 without a list)', async () => {
    const api = createSavedListsApi(
      clientAnswering(
        { customer: { basket: { id: 'b', public: false, items: [{ id: 'x' }, { id: 'y' }] } } },
        { customer: { basket: null } },
      ),
    );

    expect(await api.count('noticelist')).toBe(2);
    expect(await api.count('wishlist')).toBe(0);
  });
});
