import type { GraphqlClient } from '../api/GraphqlClient';
import { decodeJwtPayload } from './jwt';
import { REFRESH_QUERY } from './SessionRefresher';
import type { RefreshStrategy } from './RefreshStrategy';
import type { TokenStorage } from './TokenStorage';

/**
 * graphql-base `refresh(refreshToken, fingerprintHash)`: the refresh token from the storage plus the
 * `fingerprintHash` claim of the access token we hold (the HttpOnly fingerprint cookie travels with
 * the same-origin request).
 */
export class FingerprintRefreshStrategy implements RefreshStrategy {
  constructor(
    private readonly client: GraphqlClient,
    private readonly storage: TokenStorage,
  ) {}

  hasCredentials(): boolean {
    return this.storage.getRefreshToken() !== null;
  }

  canRenew(): boolean {
    return this.hasCredentials() && this.fingerprintHash() !== undefined;
  }

  async renew(): Promise<unknown> {
    const refreshToken = this.storage.getRefreshToken();
    const fingerprintHash = this.fingerprintHash();
    if (!refreshToken || fingerprintHash === undefined) {
      return undefined;
    }
    const data = await this.client.execute<{ refresh?: unknown }>(
      REFRESH_QUERY,
      { refreshToken, fingerprintHash },
      { omitToken: true },
    );
    return data.refresh;
  }

  private fingerprintHash(): string | undefined {
    const hash = decodeJwtPayload(this.storage.get() ?? '')?.fingerprintHash;
    return typeof hash === 'string' && hash !== '' ? hash : undefined;
  }
}
