export interface ResponseCacheOptions {
  /** Entries kept at most; the oldest is dropped first. */
  maxEntries?: number;
  /** Injectable clock (ms) so tests never sleep. */
  now?: () => number;
}

interface Entry {
  value: unknown;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 200;

/**
 * In-memory answer cache with expiry. Stores and expires — it knows nothing about GraphQL.
 * Concurrent requests for one key share a single load.
 */
export class ResponseCache {
  private readonly entries = new Map<string, Entry>();
  private readonly loading = new Map<string, Promise<unknown>>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  /** Bumped by `clear()`: a load that started before it must not store its (maybe stale) answer. */
  private generation = 0;

  constructor(options: ResponseCacheOptions = {}) {
    this.maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
    this.now = options.now ?? Date.now;
  }

  async remember<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const stored = this.entries.get(key);
    if (stored && stored.expiresAt > this.now()) {
      return stored.value as T;
    }
    const running = this.loading.get(key);
    if (running) {
      return running as Promise<T>;
    }

    const generation = this.generation;
    const promise = load()
      .then((value) => {
        if (generation === this.generation) {
          this.store(key, value, ttlMs);
        }
        return value;
      })
      .finally(() => {
        if (this.loading.get(key) === promise) {
          this.loading.delete(key);
        }
      });
    this.loading.set(key, promise);
    return promise;
  }

  clear(): void {
    this.generation += 1;
    this.entries.clear();
    this.loading.clear();
  }

  private store(key: string, value: unknown, ttlMs: number): void {
    this.entries.delete(key); // re-inserting moves it to the newest position
    this.entries.set(key, { value, expiresAt: this.now() + ttlMs });
    if (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }
}
