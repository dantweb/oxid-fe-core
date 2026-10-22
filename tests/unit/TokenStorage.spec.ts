import { describe, expect, it } from 'vitest';
import { TokenStorage } from '../../src/auth/TokenStorage';

function throwingStorage(): Storage {
  const fail = (): never => {
    throw new DOMException('denied');
  };
  return {
    getItem: fail,
    setItem: fail,
    removeItem: fail,
    clear: fail,
    key: fail,
    length: 0,
  };
}

describe('TokenStorage', () => {
  it('stores, returns and clears a token', () => {
    const storage = new TokenStorage(globalThis.localStorage);

    storage.set('jwt-1');
    expect(storage.get()).toBe('jwt-1');

    storage.clear();
    expect(storage.get()).toBeNull();
  });

  it('falls back to memory when the storage throws', () => {
    const storage = new TokenStorage(throwingStorage());

    storage.set('jwt-2');
    expect(storage.get()).toBe('jwt-2');

    storage.clear();
    expect(storage.get()).toBeNull();
  });

  it('works with no storage at all', () => {
    const storage = new TokenStorage(null);

    expect(storage.get()).toBeNull();
    storage.set('jwt-3');
    expect(storage.get()).toBe('jwt-3');
  });

  describe('refresh token', () => {
    it('getRefreshToken_nothingStored_returnsNull', () => {
      expect(new TokenStorage(globalThis.localStorage).getRefreshToken()).toBeNull();
    });

    it('setRefreshToken_stored_survivesANewInstanceOnTheSameStorage', () => {
      new TokenStorage(globalThis.localStorage).setRefreshToken('r-1');

      expect(new TokenStorage(globalThis.localStorage).getRefreshToken()).toBe('r-1');
      new TokenStorage(globalThis.localStorage).clear();
    });

    it('clear_removesAccessAndRefreshToken', () => {
      const storage = new TokenStorage(globalThis.localStorage);
      storage.set('jwt');
      storage.setRefreshToken('r-1');

      storage.clear();

      expect(storage.get()).toBeNull();
      expect(storage.getRefreshToken()).toBeNull();
    });

    it('clearRefreshToken_keepsTheAccessToken', () => {
      const storage = new TokenStorage(null);
      storage.set('jwt');
      storage.setRefreshToken('r-1');

      storage.clearRefreshToken();

      expect(storage.getRefreshToken()).toBeNull();
      expect(storage.get()).toBe('jwt');
    });

    it('setRefreshToken_storageThrows_fallsBackToMemory', () => {
      const storage = new TokenStorage(throwingStorage());

      storage.setRefreshToken('r-2');
      expect(storage.getRefreshToken()).toBe('r-2');

      storage.clear();
      expect(storage.getRefreshToken()).toBeNull();
    });
  });
});
