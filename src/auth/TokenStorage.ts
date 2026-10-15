const TOKEN_KEY = 'oxfe.token';

/**
 * Holds the access token. Uses the given Storage (default: localStorage)
 * and degrades to in-memory when storage is unavailable or throws
 * (private mode, blocked site data).
 */
export class TokenStorage {
  private memory: string | null = null;
  private readonly storage: Storage | null;

  constructor(storage?: Storage | null) {
    this.storage = storage !== undefined ? storage : defaultStorage();
  }

  get(): string | null {
    try {
      return this.storage?.getItem(TOKEN_KEY) ?? this.memory;
    } catch {
      return this.memory;
    }
  }

  set(token: string): void {
    this.memory = token;
    try {
      this.storage?.setItem(TOKEN_KEY, token);
    } catch {
      /* memory fallback already holds it */
    }
  }

  clear(): void {
    this.memory = null;
    try {
      this.storage?.removeItem(TOKEN_KEY);
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
