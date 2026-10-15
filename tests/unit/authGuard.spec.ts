import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { createAuthGuard } from '../../src/guards/authGuard';

function route(requiresAuth: boolean, fullPath = '/dashboard/orders'): RouteLocationNormalized {
  return {
    fullPath,
    matched: [{ meta: { requiresAuth } }],
  } as unknown as RouteLocationNormalized;
}

describe('createAuthGuard', () => {
  it('lets public routes pass regardless of auth state', () => {
    const guard = createAuthGuard({ isAuthenticated: () => false });
    expect(guard.call(undefined, route(false), route(false), () => undefined)).toBe(true);
  });

  it('lets authenticated users into protected routes', () => {
    const guard = createAuthGuard({ isAuthenticated: () => true });
    expect(guard.call(undefined, route(true), route(false), () => undefined)).toBe(true);
  });

  it('redirects guests to login with a redirect-back query', () => {
    const guard = createAuthGuard({ isAuthenticated: () => false });
    expect(guard.call(undefined, route(true), route(false), () => undefined)).toEqual({
      path: '/login',
      query: { redirect: '/dashboard/orders' },
    });
  });

  it('honors a custom login path', () => {
    const guard = createAuthGuard({ isAuthenticated: () => false }, '/signin');
    const result = guard.call(undefined, route(true), route(false), () => undefined);
    expect(result).toMatchObject({ path: '/signin' });
  });
});
