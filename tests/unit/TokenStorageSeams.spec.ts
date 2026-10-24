import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryStorage, TokenStorage } from '../../src/auth/TokenStorage';

describe('MemoryStorage', () => {
  it('implements the Storage contract in memory', () => {
    const storage = new MemoryStorage();

    storage.setItem('a', '1');
    storage.setItem('b', '2');

    expect(storage.getItem('a')).toBe('1');
    expect(storage.getItem('missing')).toBeNull();
    expect(storage.length).toBe(2);
    expect(storage.key(0)).toBe('a');
    expect(storage.key(5)).toBeNull();

    storage.removeItem('a');
    expect(storage.getItem('a')).toBeNull();

    storage.clear();
    expect(storage.length).toBe(0);
  });

  it('is isolated from localStorage', () => {
    const storage = new MemoryStorage();
    storage.setItem('only-here', 'x');

    expect(globalThis.localStorage.getItem('only-here')).toBeNull();
  });
});

describe('TokenStorage keys and namespace', () => {
  beforeEach(() => globalThis.localStorage.clear());

  it('keeps the 0.10.0 keys by default', () => {
    const storage = new TokenStorage(globalThis.localStorage);

    storage.set('access');
    storage.setRefreshToken('refresh');

    expect(globalThis.localStorage.getItem('oxfe.token')).toBe('access');
    expect(globalThis.localStorage.getItem('oxfe.refresh')).toBe('refresh');
  });

  it('prefixes both keys with a namespace', () => {
    const storage = new TokenStorage(globalThis.localStorage, { namespace: 'oxadm' });

    storage.set('access');
    storage.setRefreshToken('refresh');

    expect(globalThis.localStorage.getItem('oxadm.token')).toBe('access');
    expect(globalThis.localStorage.getItem('oxadm.refresh')).toBe('refresh');
    expect(globalThis.localStorage.getItem('oxfe.token')).toBeNull();
  });

  it('keeps two namespaces apart and clears only its own', () => {
    const storefront = new TokenStorage(globalThis.localStorage);
    const admin = new TokenStorage(globalThis.localStorage, { namespace: 'oxadm' });
    storefront.set('shopper');
    admin.set('operator');

    admin.clear();

    expect(admin.get()).toBeNull();
    expect(storefront.get()).toBe('shopper');
  });

  it('works on top of a MemoryStorage', () => {
    const backing = new MemoryStorage();
    const storage = new TokenStorage(backing, { namespace: 'oxadm' });

    storage.set('access');

    expect(backing.getItem('oxadm.token')).toBe('access');
    expect(storage.get()).toBe('access');
  });
});
