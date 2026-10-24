import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { AuthService } from '../auth/AuthService';
import { CoreEvents, type EventBus } from '../events/EventBus';

const DEFAULT_STORE_ID = 'oxfe-auth';

export interface AuthStoreOptions {
  /** Pinia store id. Default `oxfe-auth`; give each store of a host (storefront, admin) its own. */
  id?: string;
}

/**
 * Reactive mirror of the AuthService for templates. The service stays the
 * single owner of the token; the store only reflects it and re-syncs on
 * the core auth events.
 */
export function createAuthStore(
  auth: AuthService,
  events: EventBus,
  { id = DEFAULT_STORE_ID }: AuthStoreOptions = {},
) {
  return defineStore(id, () => {
    const authenticated = ref(auth.isAuthenticated());
    const username = ref<string | null>(auth.payload()?.username ?? null);

    function sync(): void {
      authenticated.value = auth.isAuthenticated();
      username.value = auth.payload()?.username ?? null;
    }

    events.on(CoreEvents.AuthLogin, sync);
    events.on(CoreEvents.AuthLogout, sync);
    events.on(CoreEvents.SessionExpired, sync);

    async function login(user: string, password: string): Promise<void> {
      await auth.login(user, password);
    }

    function logout(): void {
      auth.logout();
    }

    return { authenticated, username, login, logout, sync };
  });
}
