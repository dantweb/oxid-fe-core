import type { NavigationGuardWithThis, RouteLocationNormalized } from 'vue-router';

/**
 * Router guard: a route whose record carries `meta.requiredRight` is entered only when `hasRight`
 * says yes for every such record in the matched chain; otherwise the user is sent to `forbiddenPath`.
 * Where the rights come from (an admin session's catalogue) is the host's business.
 */
export function createRightsGuard(
  hasRight: (right: string) => boolean,
  forbiddenPath: string,
): NavigationGuardWithThis<undefined> {
  return (to: RouteLocationNormalized) => {
    const allowed = to.matched.every((record) => {
      const required = record.meta.requiredRight;
      return typeof required !== 'string' || hasRight(required);
    });
    return allowed ? true : { path: forbiddenPath };
  };
}
