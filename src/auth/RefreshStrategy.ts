/**
 * How an access token is renewed. The session scheduler, the expiry check and `ensureSession` are
 * generic; what a renewal needs (a refresh token and a fingerprint, an HttpOnly session cookie …) is
 * the strategy's business. The default is {@link FingerprintRefreshStrategy}.
 */
export interface RefreshStrategy {
  /**
   * Something to renew the stored session with exists. Decides whether an expired session is
   * renewed (true) or ended with `SessionExpired` (false).
   */
  hasCredentials(): boolean;
  /** A renewal can be attempted right now; the scheduler plans nothing while this is false. */
  canRenew(): boolean;
  /**
   * Asks the shop for a new access token and resolves to what it answered (anything but a string is
   * a refusal). Rejects with the client's error: a transport failure keeps the session and is
   * retried, any other error ends it.
   */
  renew(): Promise<unknown>;
}
