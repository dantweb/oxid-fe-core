import type { GraphqlClient } from '../api/GraphqlClient';
import { CoreEvents, type EventBus } from '../events/EventBus';
import { decodeJwtPayload, isJwtExpired, type OxidJwtPayload } from './jwt';
import { GraphqlError } from '../api/GraphqlError';
import { errorCodeOf, isTransportFailure } from '../api/errorCodes';
import { SessionRefresher } from './SessionRefresher';
import type { TokenStorage } from './TokenStorage';

/**
 * graphql-base: `token(username, password): String`; both omitted → anonymous token.
 * One document serves login and anonymous sessions.
 */
export const TOKEN_QUERY = /* GraphQL */ `
  query token($username: String, $password: String) {
    token(username: $username, password: $password)
  }
`;

/**
 * graphql-base: `login(username, password): { accessToken refreshToken }`. Besides the tokens it sets
 * the HttpOnly fingerprint cookie that `refresh` demands, and the access token carries its hash.
 */
export const LOGIN_QUERY = /* GraphQL */ `
  query login($username: String, $password: String) {
    login(username: $username, password: $password) {
      accessToken
      refreshToken
    }
  }
`;

/** graphql-base: revokes one token by the `tokenid` claim; needs the token's own bearer. */
export const TOKEN_DELETE_MUTATION = /* GraphQL */ `
  mutation tokenDelete($tokenId: ID!) {
    tokenDelete(tokenId: $tokenId)
  }
`;

export interface AuthServiceOptions {
  /**
   * Use `login`/`refresh` (default). `false` is the switch for a shop without those rights: only
   * the `token` query is used and a session ends at the access token's expiry. Left on, a shop that
   * refuses `login` is detected on the first login and the service falls back by itself.
   */
  refreshFlow?: boolean;
}

interface LoginTokens {
  accessToken: string;
  refreshToken: string;
}

/**
 * Token lifecycle over graphql-base: login (with refresh tokens, silent renewal before expiry),
 * anonymous sessions for guests, expiry detection, logout (revokes the token server-side).
 * Wires itself into the client as token provider and emits CoreEvents on the bus so host and
 * plugins can react.
 *
 * Storage: both tokens live in the {@link TokenStorage} (localStorage by default). The refresh token
 * is no weaker there than the access token it renews: it is useless without the HttpOnly
 * fingerprint cookie the shop set at login, which scripts cannot read.
 */
export class AuthService {
  private readonly refresher: SessionRefresher;
  private refreshFlowAvailable: boolean;

  constructor(
    private readonly client: GraphqlClient,
    private readonly storage: TokenStorage,
    private readonly events: EventBus,
    options: AuthServiceOptions = {},
  ) {
    this.refreshFlowAvailable = options.refreshFlow ?? true;
    this.refresher = new SessionRefresher(client, storage, () => this.dropRejectedToken());
    this.client.setTokenProvider(() => this.token());
    this.client.setTokenRejectedHandler(() => this.dropRejectedToken());
    this.refresher.start(); // a session stored by an earlier page load keeps being renewed
  }

  /** The stored token, or null. A stored value that is not even a JWT is dropped here, for good. */
  token(): string | null {
    const stored = this.storage.get();
    if (stored !== null && decodeJwtPayload(stored) === null) {
      this.clearSession();
      return null;
    }
    return stored;
  }

  payload(): OxidJwtPayload | null {
    const token = this.token();
    return token ? decodeJwtPayload(token) : null;
  }

  hasValidToken(): boolean {
    const token = this.token();
    return token !== null && !isJwtExpired(token);
  }

  /** A real customer session: valid token that is not anonymous. */
  isAuthenticated(): boolean {
    return this.hasValidToken() && this.payload()?.useranonymous !== true;
  }

  /** A valid guest session: the token's `useranonymous` claim is set. */
  isAnonymous(): boolean {
    return this.hasValidToken() && this.payload()?.useranonymous === true;
  }

  async login(username: string, password: string): Promise<void> {
    const tokens = this.refreshFlowAvailable
      ? await this.tryLoginWithRefresh(username, password)
      : null;
    if (tokens) {
      this.storage.set(tokens.accessToken);
      this.storage.setRefreshToken(tokens.refreshToken);
      this.refresher.start();
    } else {
      await this.loginWithToken(username, password);
    }
    this.events.emit(CoreEvents.AuthLogin, { username });
  }

  /** Guest session: anonymous JWT for browsing and baskets. */
  async loginAnonymous(): Promise<void> {
    const data = await this.client.execute<{ token: string }>(TOKEN_QUERY, undefined, {
      omitToken: true,
    });
    this.adoptToken(data.token);
  }

  /**
   * Any usable session (customer or guest). An expired customer session is renewed with its refresh
   * token first; an anonymous token is fetched only when that is not possible either.
   */
  async ensureSession(): Promise<void> {
    if (this.hasValidToken()) {
      return;
    }
    if (await this.refresher.refresh()) {
      return;
    }
    await this.loginAnonymous();
  }

  /** Renews the access token now; false when there is nothing to renew it with or the shop refused. */
  refresh(): Promise<boolean> {
    return this.refresher.refresh();
  }

  /**
   * Adopts a token the API handed back outside of login — e.g.
   * customerPasswordChange answers a fresh accessToken because the old
   * session token dies with the old password. The refresh token of the old
   * session goes too: the shop revokes it with the password.
   */
  adoptToken(token: string): void {
    this.refresher.stop();
    this.storage.clearRefreshToken();
    this.storage.set(token);
  }

  /**
   * Ends the session at once (storage cleared, `auth:logout` emitted) and revokes the token in the
   * shop. The returned promise settles when the revoke did; it never rejects — a shop that cannot be
   * reached keeps the token until it expires, which must not keep the shopper logged in locally.
   */
  logout(): Promise<void> {
    // dispatched before the storage is cleared: the request is built synchronously with this bearer
    const revoked = this.revokeStoredToken();
    this.clearSession();
    this.events.emit(CoreEvents.AuthLogout);
    return revoked;
  }

  private async revokeStoredToken(): Promise<void> {
    const tokenId = this.hasValidToken() ? this.payload()?.tokenid : undefined;
    if (!tokenId) {
      return;
    }
    try {
      await this.client.execute(TOKEN_DELETE_MUTATION, { tokenId });
    } catch {
      /* the local session is gone either way; the token dies at its expiry */
    }
  }

  /** `login` fails on a shop without the right or the module version; null then means "use `token`". */
  private async tryLoginWithRefresh(
    username: string,
    password: string,
  ): Promise<LoginTokens | null> {
    try {
      const data = await this.client.execute<{ login?: Partial<LoginTokens> }>(
        LOGIN_QUERY,
        { username, password },
        { omitToken: true },
      );
      const { accessToken, refreshToken } = data.login ?? {};
      return accessToken && refreshToken ? { accessToken, refreshToken } : null;
    } catch (error) {
      if (!isLoginUnavailable(error)) {
        throw error;
      }
      return null;
    }
  }

  private async loginWithToken(username: string, password: string): Promise<void> {
    // no token goes with the token query: a stale one would be refused before the login is read
    const data = await this.client.execute<{ token: string }>(
      TOKEN_QUERY,
      { username, password },
      { omitToken: true },
    );
    this.adoptToken(data.token);
    // only now is it known that the credentials were fine and `login` is what the shop refuses
    this.refreshFlowAvailable = false;
  }

  private clearSession(): void {
    this.refresher.stop();
    this.storage.clear();
  }

  /** The shop said no to our token: drop it. Only a customer's lost session is worth announcing. */
  private dropRejectedToken(): void {
    const wasCustomer = this.payload()?.useranonymous === false;
    this.clearSession();
    if (wasCustomer) {
      this.events.emit(CoreEvents.SessionExpired);
    }
  }

  /**
   * Emits SessionExpired (once per expiry) when a customer token ran out and cannot be renewed.
   * With a refresh token the renewal is started instead. The host shows its session-expired UI on
   * this event.
   */
  checkExpiry(): void {
    const token = this.token();
    if (!token) {
      return;
    }
    const payload = decodeJwtPayload(token);
    if (payload?.useranonymous === true || !isJwtExpired(token)) {
      return;
    }
    if (this.storage.getRefreshToken()) {
      void this.refresher.refresh();
      return;
    }
    this.clearSession();
    this.events.emit(CoreEvents.SessionExpired);
  }
}

/** A wrong password is a verdict and a dead network is not a missing feature; anything else is "no `login` here". */
function isLoginUnavailable(error: unknown): boolean {
  return (
    error instanceof GraphqlError &&
    !isTransportFailure(error) &&
    errorCodeOf(error) !== 'invalid_login'
  );
}
