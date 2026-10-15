import type { NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router';

interface AuthStateReader {
  isAuthenticated(): boolean;
}

/**
 * Router guard: routes with `meta.requiresAuth` need a customer session;
 * guests are sent to the login route with a redirect-back query.
 */
export function createAuthGuard(
  auth: AuthStateReader,
  loginPath = '/login',
): NavigationGuardWithThis<undefined> {
  return (to: RouteLocationNormalized) => {
    const needsAuth = to.matched.some((record) => record.meta.requiresAuth === true);
    if (!needsAuth || auth.isAuthenticated()) {
      return true;
    }
    return { path: loginPath, query: { redirect: to.fullPath } };
  };
}
