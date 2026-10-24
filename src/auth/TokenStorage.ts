const DEFAULT_NAMESPACE = 'oxfe';

export interface TokenStorageOptions {
  /** Key prefix: tokens live under `<namespace>.token` / `<namespace>.refresh`. Default `oxfe`. */
  namespace?: string;
}

/** A `Storage` that never leaves the page: for credentials that must not outlive it (an admin's access token). */
export class MemoryStorage implements Storage {
  private readonly items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  clear(): void {
    this.items.clear();
  }
}

/**
 * Holds the session credentials: the access token and, when the shop issued one, the refresh token.
 * Uses the given Storage (default: localStorage) and degrades to in-memory when storage is
 * unavailable or throws (private mode, blocked site data).
 */
export class TokenStorage {
  private readonly memory = new Map<string, string>();
  private readonly storage: Storage | null;
  private readonly tokenKey: string;
  private readonly refreshTokenKey: string;

  constructor(storage?: Storage | null, options: TokenStorageOptions = {}) {
    this.storage = storage !== undefined ? storage : defaultStorage();
    const namespace = options.namespace ?? DEFAULT_NAMESPACE;
    this.tokenKey = `${namespace}.token`;
    this.refreshTokenKey = `${namespace}.refresh`;
  }

  get(): string | null {
    return this.read(this.tokenKey);
  }

  set(token: string): void {
    this.write(this.tokenKey, token);
  }

  getRefreshToken(): string | null {
    return this.read(this.refreshTokenKey);
  }

  setRefreshToken(token: string): void {
    this.write(this.refreshTokenKey, token);
  }

  clearRefreshToken(): void {
    this.remove(this.refreshTokenKey);
  }

  /** Ends the stored session: both tokens go. */
  clear(): void {
    this.remove(this.tokenKey);
    this.remove(this.refreshTokenKey);
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? this.memory.get(key) ?? null;
    } catch {
      return this.memory.get(key) ?? null;
    }
  }

  private write(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      this.storage?.setItem(key, value);
    } catch {
      /* memory fallback already holds it */
    }
  }

  private remove(key: string): void {
    this.memory.delete(key);
    try {
      this.storage?.removeItem(key);
    } catch {
      /* nothing to clean beyond memory */
    }
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
