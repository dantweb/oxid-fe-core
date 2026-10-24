import { describe, expect, it } from 'vitest';
import { PluginRegistry } from '../../src/plugins/PluginRegistry';
import type { IPlugin, NavItem } from '../../src/plugins/types';

function plugin(name: string, navItems: NavItem[]): IPlugin {
  return { name, version: '1.0.0', navItems };
}

function treeFor(navItems: NavItem[], rights: string[]) {
  const registry = new PluginRegistry();
  registry.register(plugin('p', navItems));
  return registry.navTree((right) => rights.includes(right));
}

describe('PluginRegistry.navTree', () => {
  it('keeps items without requiredRight and drops the ones whose right is missing', () => {
    const tree = treeFor(
      [
        { labelKey: 'open', to: '/open' },
        { labelKey: 'orders', to: '/orders', requiredRight: 'ORDERS_VIEW' },
        { labelKey: 'users', to: '/users', requiredRight: 'USERS_VIEW' },
      ],
      ['ORDERS_VIEW'],
    );

    expect(tree.map((item) => item.to)).toEqual(['/open', '/orders']);
  });

  it('filters children and keeps the group while one child remains', () => {
    const tree = treeFor(
      [
        {
          labelKey: 'sales',
          to: '/sales',
          children: [
            { labelKey: 'orders', to: '/orders', requiredRight: 'ORDERS_VIEW' },
            { labelKey: 'carts', to: '/carts', requiredRight: 'CARTS_VIEW' },
          ],
        },
      ],
      ['ORDERS_VIEW'],
    );

    expect(tree).toHaveLength(1);
    expect(tree[0].children?.map((child) => child.to)).toEqual(['/orders']);
  });

  it('drops a group whose children are all filtered out', () => {
    const tree = treeFor(
      [
        {
          labelKey: 'sales',
          to: '/sales',
          children: [{ labelKey: 'orders', to: '/orders', requiredRight: 'ORDERS_VIEW' }],
        },
        { labelKey: 'home', to: '/' },
      ],
      [],
    );

    expect(tree.map((item) => item.to)).toEqual(['/']);
  });

  it('drops a group whose own right is missing, children included', () => {
    const tree = treeFor(
      [
        {
          labelKey: 'system',
          to: '/system',
          requiredRight: 'SYSTEM_VIEW',
          children: [{ labelKey: 'logs', to: '/logs' }],
        },
      ],
      [],
    );

    expect(tree).toEqual([]);
  });

  it('sorts by order at every level and merges the items of all plugins', () => {
    const registry = new PluginRegistry();
    registry.register(
      plugin('a', [
        {
          labelKey: 'g',
          to: '/g',
          order: 20,
          children: [
            { labelKey: 'c2', to: '/c2', order: 2 },
            { labelKey: 'c1', to: '/c1', order: 1 },
          ],
        },
      ]),
    );
    registry.register(plugin('b', [{ labelKey: 'first', to: '/first', order: 10 }]));

    const tree = registry.navTree(() => true);

    expect(tree.map((item) => item.to)).toEqual(['/first', '/g']);
    expect(tree[1].children?.map((child) => child.to)).toEqual(['/c1', '/c2']);
  });

  it('carries section through and leaves the plugin items untouched', () => {
    const original: NavItem[] = [
      {
        labelKey: 'g',
        to: '/g',
        section: 'catalogue',
        children: [
          { labelKey: 'x', to: '/x', requiredRight: 'NOPE' },
          { labelKey: 'y', to: '/y' },
        ],
      },
    ];

    const tree = treeFor(original, []);

    expect(tree[0].section).toBe('catalogue');
    expect(original[0].children).toHaveLength(2);
  });

  it('leaves the flat navItems getter as it was', () => {
    const registry = new PluginRegistry();
    registry.register(plugin('a', [{ labelKey: 'x', to: '/x', requiredRight: 'NOPE' }]));

    expect(registry.navItems.map((item) => item.to)).toEqual(['/x']);
  });
});
