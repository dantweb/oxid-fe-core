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
  it('reads a list from customer.baskets by its reserved title', async () => {
    const wishlist = {
      id: 'b1',
      title: 'wishlist',
      public: true,
      items: [{ id: 'i1', amount: 2, product: { id: 'p1', title: 'Kuyichi' } }],
    };
    const client = clientAnswering({
      customer: {
        baskets: [{ id: 'b0', title: 'noticelist', public: false, items: [] }, wishlist],
      },
    });

    const list = await createSavedListsApi(client).get('wishlist');

    expect(list).toEqual(wishlist);
    expect(calls(client)[0][0]).toContain('query savedLists');
    expect(calls(client)[0][0]).toContain('baskets');
    expect(calls(client)[0][0]).not.toContain('basket(');
  });

  it('answers null when no basket carries the title — without a GraphQL error', async () => {
    const client = clientAnswering(
      { customer: { baskets: [] } },
      { customer: { baskets: [{ id: 'b0', title: 'wishlist', public: false, items: [] }] } },
    );
    const api = createSavedListsApi(client);

    expect(await api.get('noticelist')).toBeNull();
    expect(await api.get('noticelist')).toBeNull();
  });

  it('rethrows any GraphQL error', async () => {
    const broken = GraphqlError.fromErrors([{ message: 'Basket "noticelist" not found' }]);
    const failing = { execute: vi.fn().mockRejectedValue(broken) } as unknown as GraphqlClient;

    await expect(createSavedListsApi(failing).get('noticelist')).rejects.toBe(broken);
  });

  it('adds to an existing list without creating one', async () => {
    const client = clientAnswering(
      {
        customer: { baskets: [{ id: 'b1', title: 'noticelist', public: false, items: [] }] },
      },
      { basketAddItem: { id: 'b1' } },
    );

    await createSavedListsApi(client).add('noticelist', 'p9');

    expect(calls(client)).toHaveLength(2);
    expect(calls(client)[1][1]).toEqual({ basketId: 'b1', productId: 'p9', amount: 1 });
  });

  it('creates the list on the first add', async () => {
    const client = clientAnswering(
      { customer: { baskets: [] } },
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
        {
          customer: {
            baskets: [
              { id: 'b', title: 'noticelist', public: false, items: [{ id: 'x' }, { id: 'y' }] },
            ],
          },
        },
        { customer: { baskets: [] } },
      ),
    );

    expect(await api.count('noticelist')).toBe(2);
    expect(await api.count('wishlist')).toBe(0);
  });
});
