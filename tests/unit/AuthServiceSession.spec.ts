import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  LOGIN_QUERY,
  TOKEN_DELETE_MUTATION,
  TOKEN_QUERY,
} from '../../src/auth/AuthService';
import { REFRESH_QUERY } from '../../src/auth/SessionRefresher';
import { TokenStorage } from '../../src/auth/TokenStorage';
import { CoreEvents, EventBus } from '../../src/events/EventBus';
import { ERROR_CODE_NETWORK, GraphqlError } from '../../src/api/GraphqlError';
import { GraphqlClient } from '../../src/api/GraphqlClient';
import { expiresIn, fakeJwt } from '../helpers/jwt';

const FINGERPRINT = 'fp-hash';
const LIFETIME_SECONDS = 600;

function customerJwt(seconds = LIFETIME_SECONDS, extra: Record<string, unknown> = {}): string {
  return fakeJwt({
    exp: expiresIn(seconds),
    useranonymous: false,
    tokenid: 'tid-1',
    fingerprintHash: FINGERPRINT,
    ...extra,
  });
}

function shopError(errorCode?: string): GraphqlError {
  return GraphqlError.fromErrors([{ message: 'raw', extensions: errorCode ? { errorCode } : {} }]);
}

type Handler = (variables: Record<string, unknown> | undefined) => unknown;

/** Answers by document: `handlers` maps the document to a result, or throws what the handler throws. */
function scriptedClient(handlers: Map<string, Handler>) {
  const execute = vi.fn(async (document: string, variables?: Record<string, unknown>) => {
    const handler = handlers.get(document);
    if (!handler) {
      throw new Error('unexpected document');
    }
    return handler(variables);
  });
  const client = {
    execute,
    setTokenProvider: vi.fn(),
    setTokenRejectedHandler: vi.fn(),
    addResponseInterceptor: vi.fn(),
  } as unknown as GraphqlClient;
  const sent = (document: string) => execute.mock.calls.filter(([doc]) => doc === document);
  return { client, execute, sent };
}

function build(
  handlers: Map<string, Handler>,
  options?: ConstructorParameters<typeof AuthService>[3],
  storage = new TokenStorage(null),
) {
  const scripted = scriptedClient(handlers);
  const events = new EventBus();
  const auth = new AuthService(scripted.client, storage, events, options);
  return { ...scripted, storage, events, auth };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('AuthService.logout — revoking the token (138e E1)', () => {
  const REVOKE_OK = new Map<string, Handler>([
    [TOKEN_DELETE_MUTATION, () => ({ tokenDelete: true })],
  ]);

  it('logout_customerToken_sendsTokenDeleteWithTheTokenId', async () => {
    const made = build(REVOKE_OK);
    made.storage.set(customerJwt());

    await made.auth.logout();

    expect(made.execute).toHaveBeenCalledWith(TOKEN_DELETE_MUTATION, { tokenId: 'tid-1' });
    expect(made.auth.token()).toBeNull();
  });

  it('logout_revokeFails_stillClearsLocallyAndDoesNotThrow', async () => {
    const made = build(
      new Map<string, Handler>([
        [
          TOKEN_DELETE_MUTATION,
          () => {
            throw shopError('invalid_token');
          },
        ],
      ]),
    );
    made.storage.set(customerJwt());
    made.storage.setRefreshToken('r-1');

    await expect(made.auth.logout()).resolves.toBeUndefined();

    expect(made.storage.get()).toBeNull();
    expect(made.storage.getRefreshToken()).toBeNull();
  });

  it('logout_networkDown_stillClearsLocallyAndDoesNotThrow', async () => {
    const made = build(
      new Map<string, Handler>([
        [
          TOKEN_DELETE_MUTATION,
          () => {
            throw new GraphqlError('down', ERROR_CODE_NETWORK);
          },
        ],
      ]),
    );
    made.storage.set(customerJwt());

    await expect(made.auth.logout()).resolves.toBeUndefined();

    expect(made.auth.token()).toBeNull();
  });

  it('logout_called_clearsAndEmitsSynchronouslyWithoutWaitingForTheShop', () => {
    const made = build(
      new Map<string, Handler>([[TOKEN_DELETE_MUTATION, () => new Promise(() => {})]]),
    );
    made.storage.set(customerJwt());
    let emitted = false;
    made.events.on(CoreEvents.AuthLogout, () => (emitted = true));

    void made.auth.logout(); // a host that does not await must still be logged out at once

    expect(made.auth.token()).toBeNull();
    expect(emitted).toBe(true);
  });

  it('logout_expiredToken_sendsNothing', async () => {
    const made = build(REVOKE_OK);
    made.storage.set(customerJwt(-10));

    await made.auth.logout();

    expect(made.execute).not.toHaveBeenCalled();
  });

  it('logout_noToken_sendsNothingButStillEmits', async () => {
    const made = build(REVOKE_OK);
    let emitted = false;
    made.events.on(CoreEvents.AuthLogout, () => (emitted = true));

    await made.auth.logout();

    expect(made.execute).not.toHaveBeenCalled();
    expect(emitted).toBe(true);
  });

  it('logout_tokenWithoutTokenId_sendsNothing', async () => {
    const made = build(REVOKE_OK);
    made.storage.set(fakeJwt({ exp: expiresIn(60), useranonymous: false }));

    await made.auth.logout();

    expect(made.execute).not.toHaveBeenCalled();
    expect(made.auth.token()).toBeNull();
  });

  it('logout_withRealClient_theRevokeCarriesTheTokenThatIsBeingRevoked', async () => {
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ data: { tokenDelete: true } }), { status: 200 }),
    );
    const client = new GraphqlClient({ url: '/graphql/', fetchFn });
    const storage = new TokenStorage(null);
    const auth = new AuthService(client, storage, new EventBus());
    const token = customerJwt();
    storage.set(token);

    await auth.logout();

    // storage is cleared before the answer arrives, the request still went out with the old bearer
    const init = (fetchFn.mock.calls[0] as unknown[])[1] as { headers: Record<string, string> };
    expect(init.headers['Authorization']).toBe(`Bearer ${token}`);
    expect(storage.get()).toBeNull();
  });
});

describe('AuthService.login — login/refresh flow (138e E2)', () => {
  const ACCESS = customerJwt();

  function loginAnswers(): Map<string, Handler> {
    return new Map<string, Handler>([
      [LOGIN_QUERY, () => ({ login: { accessToken: ACCESS, refreshToken: 'r-1' } })],
      [REFRESH_QUERY, () => ({ refresh: customerJwt() })],
    ]);
  }

  it('login_refreshFlow_storesAccessAndRefreshTokenAndEmitsLogin', async () => {
    const made = build(loginAnswers());
    const seen: unknown[] = [];
    made.events.on(CoreEvents.AuthLogin, (payload) => seen.push(payload));

    await made.auth.login('u@x', 'secret');

    expect(made.execute).toHaveBeenCalledWith(
      LOGIN_QUERY,
      { username: 'u@x', password: 'secret' },
      { omitToken: true },
    );
    expect(made.auth.token()).toBe(ACCESS);
    expect(made.storage.getRefreshToken()).toBe('r-1');
    expect(made.auth.isAuthenticated()).toBe(true);
    expect(seen).toEqual([{ username: 'u@x' }]);
  });

  describe('feature detection', () => {
    function loginUnavailable(tokenAnswer: Handler): Map<string, Handler> {
      return new Map<string, Handler>([
        [
          LOGIN_QUERY,
          () => {
            throw shopError();
          },
        ],
        [TOKEN_QUERY, tokenAnswer],
      ]);
    }

    it('login_loginRefused_fallsBackToTheTokenQuery', async () => {
      const token = customerJwt(LIFETIME_SECONDS, { fingerprintHash: undefined });
      const made = build(loginUnavailable(() => ({ token })));

      await made.auth.login('u@x', 'secret');

      expect(made.auth.token()).toBe(token);
      expect(made.storage.getRefreshToken()).toBeNull();
      expect(made.execute).toHaveBeenLastCalledWith(
        TOKEN_QUERY,
        { username: 'u@x', password: 'secret' },
        { omitToken: true },
      );
    });

    it('login_loginUnavailableOnce_isNotTriedAgainByThisInstance', async () => {
      const made = build(loginUnavailable(() => ({ token: customerJwt() })));

      await made.auth.login('u@x', 'secret');
      await made.auth.login('u@x', 'secret');

      expect(made.sent(LOGIN_QUERY)).toHaveLength(1);
      expect(made.sent(TOKEN_QUERY)).toHaveLength(2);
    });

    it('login_wrongPasswordRefusedByBoth_throwsTheTokenErrorAndKeepsTryingLogin', async () => {
      const made = build(
        loginUnavailable(() => {
          throw shopError('invalid_login');
        }),
      );

      await expect(made.auth.login('u@x', 'bad')).rejects.toMatchObject({
        errorCode: 'invalid_login',
      });
      await expect(made.auth.login('u@x', 'bad')).rejects.toMatchObject({
        errorCode: 'invalid_login',
      });

      expect(made.sent(LOGIN_QUERY)).toHaveLength(2); // a typo must not switch the refresh flow off
    });

    it('login_invalidLogin_doesNotFallBack', async () => {
      const made = build(
        new Map<string, Handler>([
          [
            LOGIN_QUERY,
            () => {
              throw shopError('invalid_login');
            },
          ],
        ]),
      );

      await expect(made.auth.login('u@x', 'bad')).rejects.toMatchObject({
        errorCode: 'invalid_login',
      });

      expect(made.sent(TOKEN_QUERY)).toHaveLength(0);
    });

    it('login_networkDown_doesNotFallBack', async () => {
      const made = build(
        new Map<string, Handler>([
          [
            LOGIN_QUERY,
            () => {
              throw new GraphqlError('down', ERROR_CODE_NETWORK);
            },
          ],
        ]),
      );

      await expect(made.auth.login('u@x', 'p')).rejects.toMatchObject({
        errorCode: 'network_error',
      });

      expect(made.sent(TOKEN_QUERY)).toHaveLength(0);
    });

    it('login_refreshFlowSwitchedOff_usesTheTokenQueryOnly', async () => {
      const made = build(
        new Map<string, Handler>([[TOKEN_QUERY, () => ({ token: customerJwt() })]]),
        { refreshFlow: false },
      );

      await made.auth.login('u@x', 'secret');

      expect(made.sent(LOGIN_QUERY)).toHaveLength(0);
      expect(made.auth.isAuthenticated()).toBe(true);
    });
  });

  describe('the scheduler', () => {
    it('refresh_beforeExp_sendsRefreshTokenAndFingerprintWithoutBearerAndStoresTheNewToken', async () => {
      const renewed = customerJwt(LIFETIME_SECONDS, { tokenid: 'tid-2' });
      const handlers = loginAnswers();
      handlers.set(REFRESH_QUERY, () => ({ refresh: renewed }));
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');

      await vi.advanceTimersByTimeAsync((LIFETIME_SECONDS - 60) * 1000 + 1);

      expect(made.execute).toHaveBeenCalledWith(
        REFRESH_QUERY,
        { refreshToken: 'r-1', fingerprintHash: FINGERPRINT },
        { omitToken: true },
      );
      expect(made.auth.token()).toBe(renewed);
      expect(made.storage.getRefreshToken()).toBe('r-1');
    });

    it('refresh_doesNotFireBeforeTheLeadTime', async () => {
      const made = build(loginAnswers());
      await made.auth.login('u@x', 'secret');

      await vi.advanceTimersByTimeAsync((LIFETIME_SECONDS - 120) * 1000);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(0);
    });

    it('refresh_succeeded_schedulesTheNextOne', async () => {
      const made = build(loginAnswers());
      await made.auth.login('u@x', 'secret');

      await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000 * 2);

      expect(made.sent(REFRESH_QUERY).length).toBeGreaterThanOrEqual(2);
    });

    it('refresh_shortLivedToken_refreshesAtThreeQuartersOfTheLifetimeNotInALoop', async () => {
      const handlers = loginAnswers();
      handlers.set(LOGIN_QUERY, () => ({
        login: { accessToken: customerJwt(40), refreshToken: 'r-1' },
      }));
      handlers.set(REFRESH_QUERY, () => ({ refresh: customerJwt(40) }));
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');

      await vi.advanceTimersByTimeAsync(29_000);
      expect(made.sent(REFRESH_QUERY)).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(made.sent(REFRESH_QUERY)).toHaveLength(1);
    });

    it('refresh_serverRefuses_dropsTheSessionAndAnnouncesExpiry', async () => {
      const handlers = loginAnswers();
      handlers.set(REFRESH_QUERY, () => {
        throw shopError();
      });
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');
      let expired = 0;
      made.events.on(CoreEvents.SessionExpired, () => expired++);

      await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000);

      expect(made.auth.token()).toBeNull();
      expect(made.storage.getRefreshToken()).toBeNull();
      expect(expired).toBe(1);
      await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000 * 2);
      expect(made.sent(REFRESH_QUERY)).toHaveLength(1); // no timer left behind
    });

    it('refresh_networkDown_keepsTheSessionAndTriesAgain', async () => {
      const handlers = loginAnswers();
      let calls = 0;
      handlers.set(REFRESH_QUERY, () => {
        calls += 1;
        if (calls === 1) {
          throw new GraphqlError('down', ERROR_CODE_NETWORK);
        }
        return { refresh: customerJwt() };
      });
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');
      let expired = 0;
      made.events.on(CoreEvents.SessionExpired, () => expired++);

      await vi.advanceTimersByTimeAsync((LIFETIME_SECONDS - 60) * 1000 + 1);
      expect(made.storage.getRefreshToken()).toBe('r-1');
      await vi.advanceTimersByTimeAsync(31_000);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(2);
      expect(expired).toBe(0);
      expect(made.auth.isAuthenticated()).toBe(true);
    });

    it('refresh_calledWhileOneIsRunning_sharesTheSingleRequest', async () => {
      const handlers = loginAnswers();
      handlers.set(REFRESH_QUERY, async () => ({ refresh: customerJwt() }));
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');

      await Promise.all([made.auth.refresh(), made.auth.refresh()]);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(1);
    });

    it('logout_whileARefreshIsInFlight_doesNotResurrectTheSession', async () => {
      let answer: (value: unknown) => void = () => {};
      const handlers = loginAnswers();
      handlers.set(REFRESH_QUERY, () => new Promise((resolve) => (answer = resolve)));
      handlers.set(TOKEN_DELETE_MUTATION, () => ({ tokenDelete: true }));
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');
      const pending = made.auth.refresh();

      await made.auth.logout();
      answer({ refresh: customerJwt() });
      await pending;

      expect(made.auth.token()).toBeNull();
    });

    it('refresh_noRefreshToken_returnsFalseAndSendsNothing', async () => {
      const made = build(loginAnswers());
      made.storage.set(customerJwt());

      await expect(made.auth.refresh()).resolves.toBe(false);

      expect(made.execute).not.toHaveBeenCalled();
    });

    it('refresh_accessTokenWithoutFingerprintClaim_returnsFalse', async () => {
      const made = build(loginAnswers());
      made.storage.set(customerJwt(LIFETIME_SECONDS, { fingerprintHash: undefined }));
      made.storage.setRefreshToken('r-1');

      await expect(made.auth.refresh()).resolves.toBe(false);

      expect(made.execute).not.toHaveBeenCalled();
    });

    it('construct_storedSessionWithRefreshToken_schedulesTheRefresh', async () => {
      const storage = new TokenStorage(null);
      storage.set(customerJwt());
      storage.setRefreshToken('r-1');
      const made = build(loginAnswers(), undefined, storage);

      await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(1);
    });

    it('construct_storedExpiredAccessTokenWithRefreshToken_refreshesAtOnce', async () => {
      const storage = new TokenStorage(null);
      storage.set(customerJwt(-10));
      storage.setRefreshToken('r-1');
      const made = build(loginAnswers(), undefined, storage);

      await vi.advanceTimersByTimeAsync(0);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(1);
    });

    it('logout_cancelsTheScheduledRefresh', async () => {
      const made = build(
        new Map<string, Handler>([
          ...loginAnswers(),
          [TOKEN_DELETE_MUTATION, () => ({ tokenDelete: true })],
        ]),
      );
      await made.auth.login('u@x', 'secret');

      await made.auth.logout();
      await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000 * 2);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(0);
    });
  });

  describe('around an expired access token', () => {
    it('checkExpiry_expiredCustomerTokenWithRefreshToken_refreshesInsteadOfExpiring', async () => {
      const made = build(loginAnswers());
      made.storage.set(customerJwt(-10));
      made.storage.setRefreshToken('r-1');
      let expired = 0;
      made.events.on(CoreEvents.SessionExpired, () => expired++);

      made.auth.checkExpiry();
      await vi.advanceTimersByTimeAsync(0);

      expect(made.sent(REFRESH_QUERY)).toHaveLength(1);
      expect(expired).toBe(0);
    });

    it('ensureSession_expiredTokenWithRefreshToken_refreshesBeforeAskingForAnAnonymousToken', async () => {
      const made = build(loginAnswers());
      made.storage.set(customerJwt(-10));
      made.storage.setRefreshToken('r-1');

      await made.auth.ensureSession();

      expect(made.sent(REFRESH_QUERY)).toHaveLength(1);
      expect(made.sent(TOKEN_QUERY)).toHaveLength(0);
      expect(made.auth.isAuthenticated()).toBe(true);
    });

    it('ensureSession_refreshRefused_fallsBackToAnAnonymousToken', async () => {
      const handlers = loginAnswers();
      handlers.set(REFRESH_QUERY, () => {
        throw shopError();
      });
      handlers.set(TOKEN_QUERY, () => ({
        token: fakeJwt({ exp: expiresIn(600), useranonymous: true }),
      }));
      const made = build(handlers);
      made.storage.set(customerJwt(-10));
      made.storage.setRefreshToken('r-1');

      await made.auth.ensureSession();

      expect(made.auth.isAnonymous()).toBe(true);
    });
  });

  describe('other ways the session changes', () => {
    it('adoptToken_replacesTheSession_refreshTokenOfTheOldPasswordIsDropped', async () => {
      const made = build(loginAnswers());
      await made.auth.login('u@x', 'secret');

      made.auth.adoptToken(customerJwt());
      await vi.advanceTimersByTimeAsync(LIFETIME_SECONDS * 1000 * 2);

      expect(made.storage.getRefreshToken()).toBeNull();
      expect(made.sent(REFRESH_QUERY)).toHaveLength(0);
    });

    it('loginAnonymous_afterACustomerSession_dropsTheCustomersRefreshToken', async () => {
      const handlers = loginAnswers();
      handlers.set(TOKEN_QUERY, () => ({
        token: fakeJwt({ exp: expiresIn(600), useranonymous: true }),
      }));
      const made = build(handlers);
      await made.auth.login('u@x', 'secret');

      await made.auth.loginAnonymous();

      expect(made.storage.getRefreshToken()).toBeNull();
      expect(made.auth.isAnonymous()).toBe(true);
    });
  });
});

describe('AuthService.isAnonymous (140c C2)', () => {
  it.each([
    ['anonymous claim true', { useranonymous: true }, true],
    ['anonymous claim false', { useranonymous: false }, false],
    ['no claim', {}, false],
  ])('isAnonymous_%s_returns%s', (_label, claims, expected) => {
    const made = build(new Map());
    made.storage.set(fakeJwt({ exp: expiresIn(600), ...claims }));

    expect(made.auth.isAnonymous()).toBe(expected);
  });

  it('isAnonymous_expiredAnonymousToken_returnsFalse', () => {
    const made = build(new Map());
    made.storage.set(fakeJwt({ exp: expiresIn(-10), useranonymous: true }));

    expect(made.auth.isAnonymous()).toBe(false);
  });

  it('isAnonymous_noToken_returnsFalse', () => {
    expect(build(new Map()).auth.isAnonymous()).toBe(false);
  });
});
