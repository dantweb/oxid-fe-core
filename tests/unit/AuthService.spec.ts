import { describe, expect, it, vi } from 'vitest';
import { AuthService, TOKEN_QUERY } from '../../src/auth/AuthService';
import { TokenStorage } from '../../src/auth/TokenStorage';
import { CoreEvents, EventBus } from '../../src/events/EventBus';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import { expiresIn, fakeJwt } from '../helpers/jwt';

function makeClient(token: string): GraphqlClient {
  return {
    execute: vi.fn().mockResolvedValue({ token }),
    setTokenProvider: vi.fn(),
    addResponseInterceptor: vi.fn(),
    setTokenRejectedHandler: vi.fn(),
  } as unknown as GraphqlClient;
}

function make(token: string) {
  const client = makeClient(token);
  const storage = new TokenStorage(null);
  const events = new EventBus();
  const auth = new AuthService(client, storage, events);
  return { client, storage, events, auth };
}

describe('AuthService', () => {
  it('registers itself as the client token provider', () => {
    const { client } = make('t');
    expect(client.setTokenProvider).toHaveBeenCalledOnce();
  });

  it('login stores the token and emits auth:login', async () => {
    const customerToken = fakeJwt({ exp: expiresIn(3600), useranonymous: false, username: 'u@x' });
    const { client, auth, events } = make(customerToken);
    const seen: unknown[] = [];
    events.on(CoreEvents.AuthLogin, (payload) => seen.push(payload));

    await auth.login('u@x', 'secret');

    // the token query never carries a token: a stale one must not block the login
    expect(client.execute).toHaveBeenCalledWith(
      TOKEN_QUERY,
      { username: 'u@x', password: 'secret' },
      { omitToken: true },
    );
    expect(auth.token()).toBe(customerToken);
    expect(auth.isAuthenticated()).toBe(true);
    expect(auth.isAnonymous()).toBe(false);
    expect(seen).toEqual([{ username: 'u@x' }]);
  });

  it('loginAnonymous yields a guest session that is not authenticated', async () => {
    const anonToken = fakeJwt({ exp: expiresIn(3600), useranonymous: true });
    const { client, auth } = make(anonToken);

    await auth.loginAnonymous();

    expect(client.execute).toHaveBeenCalledWith(TOKEN_QUERY, undefined, { omitToken: true });
    expect(auth.isAuthenticated()).toBe(false);
    expect(auth.isAnonymous()).toBe(true);
    expect(auth.hasValidToken()).toBe(true);
  });

  it('ensureSession only fetches a token when none is valid', async () => {
    const anonToken = fakeJwt({ exp: expiresIn(3600), useranonymous: true });
    const { client, auth } = make(anonToken);

    await auth.ensureSession();
    await auth.ensureSession();

    expect(client.execute).toHaveBeenCalledTimes(1);
  });

  it('logout clears the token and emits auth:logout', async () => {
    const { auth, events } = make(fakeJwt({ exp: expiresIn(3600) }));
    let emitted = false;
    events.on(CoreEvents.AuthLogout, () => (emitted = true));
    await auth.loginAnonymous();

    auth.logout();

    expect(auth.token()).toBeNull();
    expect(emitted).toBe(true);
  });

  it('adoptToken replaces the stored token (post password-change)', async () => {
    const fresh = fakeJwt({ exp: expiresIn(3600), useranonymous: false });
    const { auth } = make('unused');

    auth.adoptToken(fresh);

    expect(auth.token()).toBe(fresh);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('checkExpiry emits session-expired for an expired customer token only', () => {
    const { auth, storage, events } = make('unused');
    let expired = 0;
    events.on(CoreEvents.SessionExpired, () => expired++);

    storage.set(fakeJwt({ exp: expiresIn(-10), useranonymous: false }));
    auth.checkExpiry();
    auth.checkExpiry(); // token already cleared — no second emit

    expect(expired).toBe(1);
    expect(auth.token()).toBeNull();

    storage.set(fakeJwt({ exp: expiresIn(-10), useranonymous: true }));
    auth.checkExpiry();
    expect(expired).toBe(1); // anonymous expiry is silent
  });

  describe('a token the shop refuses', () => {
    function rejectionHandler(auth: ReturnType<typeof make>) {
      return vi.mocked(auth.client.setTokenRejectedHandler).mock.calls[0][0];
    }

    it('registers a rejection handler on the client', () => {
      const made = make('t');
      expect(made.client.setTokenRejectedHandler).toHaveBeenCalledOnce();
    });

    it('drops a refused customer token and announces the expired session', () => {
      const made = make('unused');
      made.storage.set(fakeJwt({ exp: expiresIn(3600), useranonymous: false }));
      let expired = 0;
      made.events.on(CoreEvents.SessionExpired, () => expired++);

      rejectionHandler(made)();

      expect(made.auth.token()).toBeNull();
      expect(expired).toBe(1);
    });

    it('drops a refused guest token silently (a new one is fetched on demand)', () => {
      const made = make('unused');
      made.storage.set(fakeJwt({ exp: expiresIn(3600), useranonymous: true }));
      let expired = 0;
      made.events.on(CoreEvents.SessionExpired, () => expired++);

      rejectionHandler(made)();

      expect(made.auth.token()).toBeNull();
      expect(expired).toBe(0);
    });
  });

  it.each([['garbage'], [''], ['a.b.c'], ['aaa.@@@.ccc']])(
    'a stored value that is not a JWT (%j) is dropped at read time',
    (stored) => {
      const { auth, storage } = make('unused');
      storage.set(stored);

      expect(auth.token()).toBeNull();
      expect(storage.get()).toBeNull(); // gone from storage, not just hidden
      expect(auth.hasValidToken()).toBe(false);
    },
  );
});
