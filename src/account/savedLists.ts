import type { GraphqlClient } from '../api/GraphqlClient';

/**
 * The shopper's saved product lists. OXID keeps them as baskets with reserved titles — the same
 * mechanism the Apex theme's account uses: `noticelist` is the **wish list**, `wishlist` the
 * **gift registry** (which can be made public).
 */
export type SavedListKind = 'noticelist' | 'wishlist';

export interface SavedListItem {
  id: string;
  amount: number;
  product: { id: string; title: string };
}

export interface SavedList {
  id: string;
  public: boolean;
  items: SavedListItem[];
}

export interface SavedListsApi {
  /** The list, or null while the customer has none yet. */
  get(kind: SavedListKind): Promise<SavedList | null>;
  /** Puts one more of the product on the list, creating the list on first use. */
  add(kind: SavedListKind, productId: string): Promise<void>;
  /** Takes the entry off the list (its whole amount). */
  remove(listId: string, item: Pick<SavedListItem, 'id' | 'amount'>): Promise<void>;
  setPublic(listId: string, isPublic: boolean): Promise<void>;
  count(kind: SavedListKind): Promise<number>;
}

const GET = /* GraphQL */ `
  query savedLists {
    customer {
      baskets {
        id
        title
        public
        items {
          id
          amount
          product {
            id
            title
          }
        }
      }
    }
  }
`;

const CREATE = /* GraphQL */ `
  mutation savedListCreate($title: String!) {
    basketCreate(basket: { title: $title, public: false }) {
      id
    }
  }
`;

const ADD = /* GraphQL */ `
  mutation savedListAdd($basketId: ID!, $productId: ID!, $amount: Float!) {
    basketAddItem(basketId: $basketId, productId: $productId, amount: $amount) {
      id
    }
  }
`;

const REMOVE = /* GraphQL */ `
  mutation savedListRemove($basketId: ID!, $itemId: ID!, $amount: Float!) {
    basketRemoveItem(basketId: $basketId, basketItemId: $itemId, amount: $amount) {
      id
    }
  }
`;

const MAKE_PUBLIC = /* GraphQL */ `
  mutation savedListPublic($basketId: ID!) {
    basketMakePublic(basketId: $basketId) {
      id
    }
  }
`;

const MAKE_PRIVATE = /* GraphQL */ `
  mutation savedListPrivate($basketId: ID!) {
    basketMakePrivate(basketId: $basketId) {
      id
    }
  }
`;

export function createSavedListsApi(client: GraphqlClient): SavedListsApi {
  async function get(kind: SavedListKind): Promise<SavedList | null> {
    // customer.basket(title) would throw BasketForUserNotFound (logged as ERROR by the shop) for
    // every customer without the list, so read all baskets and pick by title instead
    const data = await client.execute<{ customer: { baskets: (SavedList & { title: string })[] } }>(
      GET,
    );
    return data.customer.baskets.find((basket) => basket.title === kind) ?? null;
  }

  return {
    get,

    async add(kind, productId) {
      const existing = await get(kind);
      const basketId =
        existing?.id ??
        (await client.execute<{ basketCreate: { id: string } }>(CREATE, { title: kind }))
          .basketCreate.id;
      await client.execute(ADD, { basketId, productId, amount: 1 });
    },

    async remove(listId, item) {
      await client.execute(REMOVE, { basketId: listId, itemId: item.id, amount: item.amount });
    },

    async setPublic(listId, isPublic) {
      await client.execute(isPublic ? MAKE_PUBLIC : MAKE_PRIVATE, { basketId: listId });
    },

    async count(kind) {
      return (await get(kind))?.items.length ?? 0;
    },
  };
}
