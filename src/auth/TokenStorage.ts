const TOKEN_KEY = 'oxfe.token';
const REFRESH_TOKEN_KEY = 'oxfe.refresh';

/**
 * Holds the session credentials: the access token and, when the shop issued one, the refresh token.
 * Uses the given Storage (default: localStorage) and degrades to in-memory when storage is
 * unavailable or throws (private mode, blocked site data).
 */
export class TokenStorage {
  private readonly memory = new Map<string, string>();
  private readonly storage: Storage | null;

  constructor(storage?: Storage | null) {
    this.storage = storage !== undefined ? storage : defaultStorage();
  }

  get(): string | null {
    return this.read(TOKEN_KEY);
  }

  set(token: string): void {
    this.write(TOKEN_KEY, token);
  }

  getRefreshToken(): string | null {
    return this.read(REFRESH_TOKEN_KEY);
  }

  setRefreshToken(token: string): void {
    this.write(REFRESH_TOKEN_KEY, token);
  }

  clearRefreshToken(): void {
    this.remove(REFRESH_TOKEN_KEY);
  }

  /** Ends the stored session: both tokens go. */
  clear(): void {
    this.remove(TOKEN_KEY);
    this.remove(REFRESH_TOKEN_KEY);
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
