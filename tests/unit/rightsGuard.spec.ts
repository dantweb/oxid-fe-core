import { describe, expect, it } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';
import { createRightsGuard } from '../../src/guards/rightsGuard';

function route(...metas: Array<Record<string, unknown>>): RouteLocationNormalized {
  return {
    fullPath: '/orders',
    matched: metas.map((meta) => ({ meta })),
  } as unknown as RouteLocationNormalized;
}

function run(guard: ReturnType<typeof createRightsGuard>, to: RouteLocationNormalized) {
  return (guard as (to: RouteLocationNormalized) => unknown)(to);
}

describe('createRightsGuard', () => {
  const held = new Set(['ORDERS_VIEW']);
  const guard = createRightsGuard((right) => held.has(right), '/forbidden');

  it.each([
    ['no requiredRight', [{}], true],
    ['right present', [{ requiredRight: 'ORDERS_VIEW' }], true],
    ['right absent', [{ requiredRight: 'ORDERS_EDIT' }], { path: '/forbidden' }],
    [
      'parent record demands a missing right',
      [{ requiredRight: 'USERS_VIEW' }, {}],
      { path: '/forbidden' },
    ],
    [
      'child record demands a missing right',
      [{}, { requiredRight: 'USERS_VIEW' }],
      { path: '/forbidden' },
    ],
    [
      'every record satisfied',
      [{ requiredRight: 'ORDERS_VIEW' }, { requiredRight: 'ORDERS_VIEW' }],
      true,
    ],
    ['a non-string requiredRight is ignored', [{ requiredRight: 7 }], true],
  ])('%s', (_name, metas, expected) => {
    expect(run(guard, route(...(metas as Array<Record<string, unknown>>)))).toEqual(expected);
  });

  it('asks the predicate with the route right', () => {
    const asked: string[] = [];
    const spy = createRightsGuard((right) => (asked.push(right), true), '/forbidden');

    run(spy, route({ requiredRight: 'A' }, { requiredRight: 'B' }));

    expect(asked).toEqual(['A', 'B']);
  });
});
