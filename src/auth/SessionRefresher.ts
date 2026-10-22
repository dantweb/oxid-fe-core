import { isTransportFailure } from '../api/errorCodes';
import { decodeJwtPayload } from './jwt';
import type { RefreshStrategy } from './RefreshStrategy';
import type { TokenStorage } from './TokenStorage';

/**
 * graphql-base: `refresh(refreshToken, fingerprintHash): String` answers a new access token — the
 * document of the default {@link FingerprintRefreshStrategy}. The shop also wants the HttpOnly
 * fingerprint cookie `login` set (same-origin requests carry it); `fingerprintHash` is the claim of
 * the access token we hold.
 */
export const REFRESH_QUERY = /* GraphQL */ `
  query refresh($refreshToken: String!, $fingerprintHash: String!) {
    refresh(refreshToken: $refreshToken, fingerprintHash: $fingerprintHash)
  }
`;

/** Refresh this long before `exp` — or at three quarters of the lifetime when that is shorter. */
const LEAD_MS = 60_000;
const LEAD_FRACTION = 0.25;
/** After a transport failure the session is kept and the refresh tried again. */
const RETRY_MS = 30_000;
/** `setTimeout` overflows beyond this and would fire at once. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Keeps an access token alive: refreshes it shortly before it expires. Owns the timer and the
 * one-at-a-time rule; the renewal itself is the {@link RefreshStrategy}'s, and what a refused one
 * means for the session is the owner's decision (`onRefused`).
 */
export class SessionRefresher {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running: Promise<boolean> | null = null;

  constructor(
    private readonly strategy: RefreshStrategy,
    private readonly storage: TokenStorage,
    private readonly onRefused: () => void,
  ) {}

  /** Something to renew an expired session with exists (see {@link RefreshStrategy.hasCredentials}). */
  hasCredentials(): boolean {
    return this.strategy.hasCredentials();
  }

  /** (Re)plans the next refresh from the stored session; does nothing when it cannot be renewed. */
  start(): void {
    this.stop();
    const delay = this.delayUntilRefresh();
    if (delay === null) {
      return;
    }
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.refresh();
      },
      Math.min(delay, MAX_TIMER_MS),
    );
  }

  stop(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** One refresh at a time; resolves to whether the session now holds a fresh access token. */
  refresh(): Promise<boolean> {
    this.running ??= this.performRefresh().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async performRefresh(): Promise<boolean> {
    if (!this.strategy.canRenew()) {
      return false;
    }
    const session = this.sessionIdentity();
    try {
      return this.adopt(session, await this.strategy.renew());
    } catch (error) {
      this.handleFailure(error);
      return false;
    }
  }

  /** What identifies the session a renewal was asked for; a different one later means "ended meanwhile". */
  private sessionIdentity(): string {
    return `${this.storage.get()}\n${this.storage.getRefreshToken()}`;
  }

  private adopt(askedFor: string, renewed: unknown): boolean {
    if (this.sessionIdentity() !== askedFor) {
      return false; // logged out (or logged in again) while the shop was answering
    }
    if (typeof renewed !== 'string') {
      this.refuse();
      return false;
    }
    this.storage.set(renewed);
    this.start();
    return true;
  }

  private handleFailure(error: unknown): void {
    if (!isTransportFailure(error)) {
      this.refuse();
      return;
    }
    this.retryWhileTokenIsAlive();
  }

  private refuse(): void {
    this.stop();
    this.onRefused();
  }

  private retryWhileTokenIsAlive(): void {
    this.stop();
    const remaining = this.remainingMs();
    if (remaining === null || remaining <= 0) {
      return; // expired: the next ensureSession / checkExpiry asks again
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, RETRY_MS);
  }

  private delayUntilRefresh(): number | null {
    const remaining = this.remainingMs();
    if (remaining === null || !this.strategy.canRenew()) {
      return null;
    }
    return Math.max(0, remaining - Math.min(LEAD_MS, remaining * LEAD_FRACTION));
  }

  /** Milliseconds until `exp`; null when the stored token has none. */
  private remainingMs(): number | null {
    const payload = decodeJwtPayload(this.storage.get() ?? '');
    if (!payload?.exp) {
      return null;
    }
    return payload.exp * 1000 - Date.now();
  }
}
