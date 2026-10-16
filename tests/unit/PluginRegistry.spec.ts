import { describe, expect, it, vi } from 'vitest';
import { PluginRegistry } from '../../src/plugins/PluginRegistry';
import type { IPlugin, PluginContext } from '../../src/plugins/types';

const shopPlugin: IPlugin = {
  name: 'shop',
  version: '0.1.0',
  routes: [{ path: '/shop', component: {} }],
  navItems: [{ labelKey: 'shop.nav.catalog', to: '/shop', order: 10 }],
  messages: { en: { nav: { catalog: 'Catalog' } }, de: { nav: { catalog: 'Katalog' } } },
  defaultConfig: { products_per_page: 12, show_out_of_stock: true },
};

describe('PluginRegistry', () => {
  it('registers plugins and rejects duplicates', () => {
    const registry = new PluginRegistry();
    registry.register(shopPlugin);

    expect(registry.has('shop')).toBe(true);
    expect(() => registry.register(shopPlugin)).toThrow('already registered');
  });

  it('aggregates routes and sorts nav items by order', () => {
    const registry = new PluginRegistry();
    registry.register(shopPlugin);
    registry.register({
      name: 'dashboard',
      version: '0.1.0',
      routes: [{ path: '/dashboard', component: {} }],
      navItems: [{ labelKey: 'dashboard.nav', to: '/dashboard', order: 5 }],
    });

    expect(registry.routes.map((r) => r.path)).toEqual(['/shop', '/dashboard']);
    expect(registry.navItems.map((n) => n.to)).toEqual(['/dashboard', '/shop']);
  });

  it('merges config overrides over the plugin defaults', () => {
    const registry = new PluginRegistry();
    registry.register(shopPlugin, { products_per_page: 24 });

    expect(registry.configOf('shop')).toEqual({ products_per_page: 24, show_out_of_stock: true });
    expect(registry.configOf('missing')).toEqual({});
  });

  it('namespaces messages per plugin and locale', () => {
    const registry = new PluginRegistry();
    registry.register(shopPlugin);

    expect(registry.messagesFor('de')).toEqual({ shop: { nav: { catalog: 'Katalog' } } });
    expect(registry.messagesFor('fr')).toEqual({});
  });

  it('setupAll passes each plugin its merged config', async () => {
    const registry = new PluginRegistry();
    const setup = vi.fn();
    registry.register({ ...shopPlugin, setup }, { products_per_page: 6 });

    const base = { client: {}, auth: {}, events: {} } as unknown as Omit<PluginContext, 'config'>;
    await registry.setupAll(base);

    expect(setup).toHaveBeenCalledWith(
      expect.objectContaining({ config: { products_per_page: 6, show_out_of_stock: true } }),
    );
  });
});

describe('layout plugin seam', () => {
  const loaderOf = (name: string) => async () => ({ default: { name } });

  it('overrideFor returns null without overrides and the supplied view with one', () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'shop', version: '1' });
    expect(registry.overrideFor('header')).toBeNull();

    const header = loaderOf('header');
    registry.register({ name: 'layout', version: '1', overrides: { header } });
    expect(registry.overrideFor('header')).toBe(header);
    expect(registry.overrideFor('home')).toBeNull();
  });

  it('with several overriding plugins the one registered last wins', () => {
    const registry = new PluginRegistry();
    const first = loaderOf('first');
    const second = loaderOf('second');
    registry.register({ name: 'a', version: '1', overrides: { home: first } });
    registry.register({ name: 'b', version: '1', overrides: { home: second } });

    expect(registry.overrideFor('home')).toBe(second);
  });

  it('overlays collects every plugin’s global components in registration order', () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'shop', version: '1' });
    expect(registry.overlays()).toEqual([]);

    const consent = loaderOf('consent');
    const banner = loaderOf('banner');
    registry.register({ name: 'a', version: '1', overlays: [consent] });
    registry.register({ name: 'b', version: '1', overlays: [banner] });
    expect(registry.overlays()).toEqual([consent, banner]);
  });

  it('defaultTheme is the first declared plugin theme, or null', () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'shop', version: '1' });
    expect(registry.defaultTheme()).toBeNull();

    registry.register({ name: 'layout', version: '1', defaultTheme: 'peroxid' });
    registry.register({ name: 'other', version: '1', defaultTheme: 'dark' });
    expect(registry.defaultTheme()).toBe('peroxid');
  });

  it('requires: a missing required plugin fails setupAll with a clear message', async () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'layout', version: '1', requires: ['shop'] });

    const base = { client: {}, auth: {}, events: {}, registry } as unknown as Omit<
      PluginContext,
      'config'
    >;
    await expect(registry.setupAll(base)).rejects.toThrow(
      'plugin "layout" requires "shop", which is not enabled',
    );

    registry.register({ name: 'shop', version: '1' });
    await expect(registry.setupAll(base)).resolves.toBeUndefined();
  });
});
