import type { GraphqlClient } from '../api/GraphqlClient';
import { CoreEvents, type EventBus } from '../events/EventBus';
import { decodeJwtPayload, isJwtExpired, type OxidJwtPayload } from './jwt';
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
 * Token lifecycle over graphql-base: login, anonymous sessions for guests,
 * expiry detection, logout. Wires itself into the client as token provider
 * and emits CoreEvents on the bus so host and plugins can react.
 *
 * Refresh tokens (graphql-base `refresh(refreshToken, fingerprintHash)`) are
 * not implemented yet: they need the fingerprint cookie contract — tracked
 * for a later sprint; until then an expired session re-authenticates.
 */
export class AuthService {
  constructor(
    private readonly client: GraphqlClient,
    private readonly storage: TokenStorage,
    private readonly events: EventBus,
  ) {
    this.client.setTokenProvider(() => this.token());
    this.client.setTokenRejectedHandler(() => this.dropRejectedToken());
  }

  /** The stored token, or null. A stored value that is not even a JWT is dropped here, for good. */
  token(): string | null {
    const stored = this.storage.get();
    if (stored !== null && decodeJwtPayload(stored) === null) {
      this.storage.clear();
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

  isAnonymous(): boolean {
    return this.hasValidToken() && this.payload()?.useranonymous === true;
  }

  async login(username: string, password: string): Promise<void> {
    // no token goes with the token query: a stale one would be refused before the login is read
    const data = await this.client.execute<{ token: string }>(
      TOKEN_QUERY,
      { username, password },
      { omitToken: true },
    );
    this.storage.set(data.token);
    this.events.emit(CoreEvents.AuthLogin, { username });
  }

  /** Guest session: anonymous JWT for browsing and baskets. */
  async loginAnonymous(): Promise<void> {
    const data = await this.client.execute<{ token: string }>(TOKEN_QUERY, undefined, {
      omitToken: true,
    });
    this.storage.set(data.token);
  }

  /** Any usable session (customer or guest); fetches an anonymous token when none is valid. */
  async ensureSession(): Promise<void> {
    if (!this.hasValidToken()) {
      await this.loginAnonymous();
    }
  }

  /**
   * Adopts a token the API handed back outside of login — e.g.
   * customerPasswordChange answers a fresh accessToken because the old
   * session token dies with the old password.
   */
  adoptToken(token: string): void {
    this.storage.set(token);
  }

  logout(): void {
    this.storage.clear();
    this.events.emit(CoreEvents.AuthLogout);
  }

  /** The shop said no to our token: drop it. Only a customer's lost session is worth announcing. */
  private dropRejectedToken(): void {
    const wasCustomer = this.payload()?.useranonymous === false;
    this.storage.clear();
    if (wasCustomer) {
      this.events.emit(CoreEvents.SessionExpired);
    }
  }

  /**
   * Emits SessionExpired (once per expiry) when a customer token ran out.
   * The host shows its session-expired UI on this event.
   */
  checkExpiry(): void {
    const token = this.token();
    if (!token) {
      return;
    }
    const payload = decodeJwtPayload(token);
    if (payload?.useranonymous !== true && isJwtExpired(token)) {
      this.storage.clear();
      this.events.emit(CoreEvents.SessionExpired);
    }
  }
}
