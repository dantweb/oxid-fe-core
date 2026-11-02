import { describe, expect, it, vi } from 'vitest';
import {
  AuthService,
  SEALED_LOGIN_MUTATION,
  SEALED_TOKEN_MUTATION,
} from '../../src/auth/AuthService';
import { TokenStorage } from '../../src/auth/TokenStorage';
import { GraphqlError } from '../../src/api/GraphqlError';
import { EventBus } from '../../src/events/EventBus';
import { expiresIn, fakeJwt } from '../helpers/jwt';

const ACCESS = fakeJwt({ exp: expiresIn(3600), useranonymous: false, username: 'u@x' });

function make(execute: ReturnType<typeof vi.fn>, sealedLogin = true) {
  const client = {
    execute,
    setTokenProvider: vi.fn(),
    addResponseInterceptor: vi.fn(),
    setTokenRejectedHandler: vi.fn(),
  };
  const storage = new TokenStorage(null);
  const auth = new AuthService(client as never, storage, new EventBus(), { sealedLogin });
  return { auth, storage };
}

const SEAL = { sealedArguments: { password: { path: 'sealedLogin.password', into: 'password' } } };

describe('AuthService with a sealed login', () => {
  it('logs in with the sealed login mutation and names the password as the sealed variable', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ sealedLogin: { accessToken: ACCESS, refreshToken: 'r' } });
    const { auth, storage } = make(execute);

    await auth.login('u@x', 'secret');

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith(
      SEALED_LOGIN_MUTATION,
      { username: 'u@x', password: 'secret' },
      { omitToken: true, ...SEAL },
    );
    expect(storage.get()).toBe(ACCESS);
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('falls back to the sealed token mutation when the shop refuses `login`, never to the plain query', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new GraphqlError('no right', 'permission_denied'))
      .mockResolvedValueOnce({ sealedToken: ACCESS });
    const { auth } = make(execute);

    await auth.login('u@x', 'secret');

    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      SEALED_LOGIN_MUTATION,
      SEALED_TOKEN_MUTATION,
    ]);
    expect(execute.mock.calls[1][2]).toMatchObject({
      sealedArguments: { password: { path: 'sealedToken.password', into: 'password' } },
    });
    expect(auth.isAuthenticated()).toBe(true);
  });

  it('a wrong password is the answer, not a reason to try `sealedToken`', async () => {
    const execute = vi.fn().mockRejectedValue(new GraphqlError('Invalid login', 'invalid_login'));
    const { auth } = make(execute);

    await expect(auth.login('u@x', 'bad')).rejects.toMatchObject({ errorCode: 'invalid_login' });

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('keeps the plain documents when sealing is off', async () => {
    const execute = vi
      .fn()
      .mockResolvedValue({ login: { accessToken: ACCESS, refreshToken: 'r' } });
    const { auth } = make(execute, false);

    await auth.login('u@x', 'secret');

    expect(String(execute.mock.calls[0][0])).toContain('query login');
    expect(execute.mock.calls[0][2]).toEqual({ omitToken: true });
  });
});
