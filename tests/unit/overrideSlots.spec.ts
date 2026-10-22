import { describe, expect, expectTypeOf, it } from 'vitest';
import { PluginRegistry } from '../../src/plugins/PluginRegistry';
import {
  STOREFRONT_SLOTS,
  type IPlugin,
  type OverrideSlot,
  type StorefrontSlot,
  type ViewLoader,
} from '../../src/plugins/types';

const loader: ViewLoader = async () => ({ default: {} });

describe('override slots', () => {
  it('exports the storefront slots as constants', () => {
    expect(STOREFRONT_SLOTS).toEqual({ header: 'header', footer: 'footer', home: 'home' });
    expectTypeOf<StorefrontSlot>().toEqualTypeOf<'header' | 'footer' | 'home'>();
  });

  it('accepts any string as a slot by default', () => {
    const registry = new PluginRegistry();
    registry.register({
      name: 'admin-layout',
      version: '1.0.0',
      overrides: { topbar: loader, 'entityTabs:order': loader },
    });

    expect(registry.overrideFor('topbar')).toBe(loader);
    expect(registry.overrideFor('entityTabs:order')).toBe(loader);
    expect(registry.overrideFor('dashboard')).toBeNull();
    expectTypeOf<OverrideSlot>().toEqualTypeOf<string>();
  });

  it('keeps the storefront usage working with the constants', () => {
    const registry = new PluginRegistry();
    registry.register({ name: 'layout', version: '1.0.0', overrides: { header: loader } });

    expect(registry.overrideFor(STOREFRONT_SLOTS.header)).toBe(loader);
    expect(registry.overrideFor(STOREFRONT_SLOTS.footer)).toBeNull();
  });

  it('lets a host narrow the slots it knows', () => {
    type AdminSlot = 'topbar' | 'dashboard';
    const registry = new PluginRegistry<AdminSlot>();
    const plugin: IPlugin<AdminSlot> = {
      name: 'a',
      version: '1',
      overrides: { topbar: loader },
    };
    registry.register(plugin);

    expect(registry.overrideFor('topbar')).toBe(loader);
    // @ts-expect-error 'footer' is not a slot of this host
    registry.overrideFor('footer');
    // @ts-expect-error a plugin of this host cannot override a slot the host does not have
    const wrong: IPlugin<AdminSlot> = { name: 'b', version: '1', overrides: { footer: loader } };
    expect(wrong.name).toBe('b');
  });
});
