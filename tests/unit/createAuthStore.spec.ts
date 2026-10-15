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
