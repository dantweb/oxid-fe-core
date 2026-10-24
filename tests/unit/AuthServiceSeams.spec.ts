import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService, TOKEN_QUERY } from '../../src/auth/AuthService';
import type { RefreshStrategy } from '../../src/auth/RefreshStrategy';
import { MemoryStorage, TokenStorage } from '../../src/auth/TokenStorage';
import { CoreEvents, EventBus } from '../../src/events/EventBus';
import { ERROR_CODE_NETWORK, GraphqlError } from '../../src/api/GraphqlError';
import type { GraphqlClient } from '../../src/api/GraphqlClient';
import { expiresIn, fakeJwt } from '../helpers/jwt';

function operatorJwt(seconds = 600, extra: Record<string, unknown> = {}): string {
  return fakeJwt({ exp: expiresIn(seconds), useranonymous: false, username: 'op', ...extra });
}

function stubClient(anonymousToken = fakeJwt({ exp: expiresIn(600), useranonymous: true })) {
  const execute = vi.fn(async () => ({ token: anonymousToken }));
  const client = {
    execute,
    setTokenProvider: vi.fn(),
    setTokenRejectedHandler: vi.fn(),
  } as unknown as GraphqlClient;
  return { client, execute };
}

/** A cookie-style strategy: no refresh token, the shop knows the session. */
function cookieStrategy(renew: () => Promise<unknown>): RefreshStrategy & {
  renew: ReturnType<typeof vi.fn>;
} {
  return { hasCredentials: () => true, canRenew: () => true, renew: vi.fn(renew) };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AuthService anonymousFallback', () => {
  it('mints an anonymous token by default (0.10.0 behaviour)', async () => {
    const { client, execute } = stubClient();
    const auth = new AuthService(client, new TokenStorage(null), new EventBus());

    await auth.ensureSession();

    expect(execute).toHaveBeenCalledWith(TOKEN_QUERY, undefined, { omitToken: true });
    expect(auth.isAnonymous()).toBe(true);
  });

  it('never mints one with anonymousFallback: false', async () => {
    const { client, execute } = stubClient();
    const auth = new AuthService(client, new TokenStorage(null), new EventBus(), {
      anonymousFallback: false,
    });

    await auth.ensureSession();

    expect(execute).not.toHaveBeenCalled();
    expect(auth.token()).toBeNull();
    expect(auth.isAuthenticated()).toBe(false);
  });

  it('keeps a valid session untouched with anonymousFallback: false', async () => {
    const { client, execute } = stubClient();
    const storage = new TokenStorage(new MemoryStorage());
    const token = operatorJwt();
    storage.set(token);
    const auth = new AuthService(client, storage, new EventBus(), { anonymousFallback: false });

    await auth.ensureSession();

    expect(execute).not.toHaveBeenCalled();
    expect(auth.token()).toBe(token);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('does not count an anonymous token as authenticated', () => {
    const { client } = stubClient();
    const storage = new TokenStorage(null);
    storage.set(fakeJwt({ exp: expiresIn(600), useranonymous: true }));
    const auth = new AuthService(client, storage, new EventBus(), { anonymousFallback: false });

    expect(auth.isAuthenticated()).toBe(false);
  });
});

describe('AuthService refreshStrategy', () => {
  it('renews an expired session through the strategy in ensureSession', async () => {
    const { client, execute } = stubClient();
    const storage = new TokenStorage(null);
    storage.set(operatorJwt(-10));
    const renewed = operatorJwt(900);
    const strategy = cookieStrategy(async () => renewed);
    const auth = new AuthService(client, storage, new EventBus(), {
      anonymousFallback: false,
      refreshStrategy: strategy,
    });

    await auth.ensureSession();

    expect(strategy.renew).toHaveBeenCalledOnce();
    expect(auth.token()).toBe(renewed);
    expect(execute).not.toHaveBeenCalled();
  });

  it('plans the silent renewal for a token adopted after a login of the host', async () => {
    const { client } = stubClient();
    const storage = new TokenStorage(null);
    const renewed = operatorJwt(900);
    const strategy = cookieStrategy(async () => renewed);
    const auth = new AuthService(client, storage, new EventBus(), { refreshStrategy: strategy });

    auth.adoptToken(operatorJwt(120));
    await vi.advanceTimersByTimeAsync(120_000);

    expect(strategy.renew).toHaveBeenCalledOnce();
    expect(auth.token()).toBe(renewed);
  });

  it('drops the session and announces it when the strategy is refused', async () => {
    const { client } = stubClient();
    const storage = new TokenStorage(null);
    storage.set(operatorJwt(-10));
    const strategy = cookieStrategy(async () => {
      throw GraphqlError.fromErrors([
        { message: 'revoked', extensions: { errorCode: 'admin_session_revoked' } },
      ]);
    });
    const events = new EventBus();
    const expired = vi.fn();
    events.on(CoreEvents.SessionExpired, expired);
    const auth = new AuthService(client, storage, events, { refreshStrategy: strategy });

    const renewed = await auth.refresh();

    expect(renewed).toBe(false);
    expect(auth.token()).toBeNull();
    expect(expired).toHaveBeenCalledOnce();
  });

  it('keeps the session when the strategy fails on the network', async () => {
    const { client } = stubClient();
    const storage = new TokenStorage(null);
    const token = operatorJwt(600);
    storage.set(token);
    const strategy = cookieStrategy(async () => {
      throw new GraphqlError('down', ERROR_CODE_NETWORK);
    });
    const auth = new AuthService(client, storage, new EventBus(), { refreshStrategy: strategy });

    expect(await auth.refresh()).toBe(false);
    expect(auth.token()).toBe(token);
  });

  it('discards the answer when the session ended while the strategy was waiting', async () => {
    const { client } = stubClient();
    const storage = new TokenStorage(null);
    storage.set(operatorJwt(600));
    let answer: (value: unknown) => void = () => {};
    const strategy = cookieStrategy(() => new Promise((resolve) => (answer = resolve)));
    const auth = new AuthService(client, storage, new EventBus(), { refreshStrategy: strategy });

    const pending = auth.refresh();
    storage.clear(); // e.g. logout in this tab
    answer(operatorJwt(900));

    expect(await pending).toBe(false);
    expect(auth.token()).toBeNull();
  });

  it('checkExpiry renews via the strategy instead of ending an expired session', () => {
    const { client } = stubClient();
    const storage = new TokenStorage(null);
    storage.set(operatorJwt(-10));
    const strategy = cookieStrategy(async () => operatorJwt(900));
    const auth = new AuthService(client, storage, new EventBus(), { refreshStrategy: strategy });

    auth.checkExpiry();

    expect(strategy.renew).toHaveBeenCalledOnce();
  });
});
