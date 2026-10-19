import { ref, type Ref } from 'vue';
import type { GraphqlClient } from '../api/GraphqlClient';
import type { AuthService } from '../auth/AuthService';
import { fetchSealedConfig, type SealedValues } from './sealedConfig';

export interface SealedKeysOptions<T> {
  provider: string;
  /** Fetches the sealed values — `fetchSealedConfig` bound to the client. */
  fetchValues: (provider: string) => Promise<SealedValues>;
  /** The current session token id: an answer is bound to it, so a new session asks again. */
  tokenId: () => string | undefined;
  /** Picks and validates what the provider SDK needs; throws when something is missing. */
  parse: (values: SealedValues) => T;
}

export interface SealedKeys<T> {
  /** True once obtaining the keys failed: the plugin must then use the hosted (redirect) flow. */
  failed: Ref<boolean>;
  load(): Promise<T>;
}

/**
 * A payment plugin's keys, kept in memory only: fetched when first needed, shared between
 * concurrent callers, refetched only for a new session, and — once a fetch failed — not retried
 * for the rest of the page. `failed` is reactive so the checkout can switch to the hosted flow.
 */
export function createSealedKeys<T>(options: SealedKeysOptions<T>): SealedKeys<T> {
  const failed = ref(false);
  let cached: { tokenId: string | undefined; promise: Promise<T> } | null = null;

  async function load(): Promise<T> {
    const tokenId = options.tokenId();
    if (cached && cached.tokenId === tokenId) {
      return cached.promise;
    }
    const promise = options.fetchValues(options.provider).then(options.parse);
    cached = { tokenId, promise };
    try {
      return await promise;
    } catch (error) {
      failed.value = true;
      throw error;
    }
  }

  return { failed, load };
}

/** The usual wiring of a payment plugin: the shop client, bound to the current session. */
export function sealedKeysForPlugin<T>(
  context: { client: Pick<GraphqlClient, 'execute'>; auth: Pick<AuthService, 'payload'> },
  provider: string,
  parse: (values: SealedValues) => T,
): SealedKeys<T> {
  const tokenId = (): string | undefined => {
    const claim = context.auth.payload()?.tokenid;
    return typeof claim === 'string' ? claim : undefined;
  };
  return createSealedKeys({
    provider,
    fetchValues: (name) => fetchSealedConfig(context.client, name, { tokenId: tokenId() }),
    tokenId,
    parse,
  });
}
