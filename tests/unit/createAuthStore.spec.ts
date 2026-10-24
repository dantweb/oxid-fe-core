import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../../src/auth/AuthService';
import { TokenStorage } from '../../src/auth/TokenStorage';
import { EventBus } from '../../src/events/EventBus';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import { createAuthStore } from '../../src/stores/createAuthStore';
import { expiresIn, fakeJwt } from '../helpers/jwt';

describe('createAuthStore', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('reflects login and logout through the service events', async () => {
    const customerToken = fakeJwt({ exp: expiresIn(3600), useranonymous: false, username: 'u@x' });
    const client = {
      execute: vi.fn().mockResolvedValue({ token: customerToken }),
      setTokenProvider: vi.fn(),
      setTokenRejectedHandler: vi.fn(),
    } as unknown as GraphqlClient;
    const events = new EventBus();
    const auth = new AuthService(client, new TokenStorage(null), events);
    const useAuthStore = createAuthStore(auth, events);
    const store = useAuthStore();

    expect(store.authenticated).toBe(false);

    await store.login('u@x', 'secret');
    expect(store.authenticated).toBe(true);
    expect(store.username).toBe('u@x');

    store.logout();
    expect(store.authenticated).toBe(false);
    expect(store.username).toBeNull();
  });
});

describe('createAuthStore id', () => {
  beforeEach(() => setActivePinia(createPinia()));

  function service() {
    const client = {
      execute: vi.fn(),
      setTokenProvider: vi.fn(),
      setTokenRejectedHandler: vi.fn(),
    } as unknown as GraphqlClient;
    const events = new EventBus();
    return { auth: new AuthService(client, new TokenStorage(null), events), events };
  }

  it('is oxfe-auth by default', () => {
    const { auth, events } = service();

    expect(createAuthStore(auth, events).$id).toBe('oxfe-auth');
  });

  it('takes a configurable id so two stores never collide', () => {
    const storefront = service();
    const admin = service();
    admin.auth.adoptToken(fakeJwt({ exp: expiresIn(600), useranonymous: false, username: 'op' }));

    const shopStore = createAuthStore(storefront.auth, storefront.events)();
    const adminStore = createAuthStore(admin.auth, admin.events, { id: 'oxadm-auth' })();

    expect(adminStore.$id).toBe('oxadm-auth');
    expect(adminStore.authenticated).toBe(true);
    expect(shopStore.authenticated).toBe(false);
  });
});
