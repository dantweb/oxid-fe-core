import { describe, expect, it } from 'vitest';
import {
  enabledPluginNames,
  isPluginEnabled,
  selectPlugins,
  type PluginSwitches,
} from '../../src/plugins/pluginSwitch';

const plugin = (name: string, module?: string) => ({ name, version: '1.0.0', module });
const BUILT = [
  plugin('payment-base'),
  plugin('stripe', 'stripe'),
  plugin('analytics'),
  plugin('admin-assistant', 'oe_admin_assistant'),
];

describe('enabledPluginNames / isPluginEnabled', () => {
  it('a list (oxid-fe-admin `admin.plugins_enabled`): every listed name, in config order', () => {
    const switches: PluginSwitches = ['analytics', 'payment-base'];
    expect(enabledPluginNames(switches)).toEqual(['analytics', 'payment-base']);
    expect(isPluginEnabled('analytics', switches)).toBe(true);
    expect(isPluginEnabled('stripe', switches)).toBe(false);
  });

  it('a map (oxid-fe-user `plugins`): `enabled` defaults to true, `false` switches off', () => {
    const switches: PluginSwitches = {
      cms: {},
      checkout: { enabled: true },
      reviews: { enabled: false },
    };
    expect(enabledPluginNames(switches)).toEqual(['cms', 'checkout']);
    expect(isPluginEnabled('reviews', switches)).toBe(false);
    expect(isPluginEnabled('cms', switches)).toBe(true);
  });

  it('nothing configured switches everything off', () => {
    expect(enabledPluginNames([])).toEqual([]);
    expect(enabledPluginNames({})).toEqual([]);
  });

  it('a name listed twice counts once', () => {
    expect(enabledPluginNames(['stripe', 'stripe'])).toEqual(['stripe']);
  });
});

describe('selectPlugins', () => {
  it('keeps the build order (requires depends on it) and reports switched-on names no plugin carries', () => {
    const { active, unknown } = selectPlugins(BUILT, [
      'admin-assistant',
      'payment-tab-plugin',
      'payment-base',
    ]);
    expect(active.map((entry) => entry.name)).toEqual(['payment-base', 'admin-assistant']);
    expect(unknown).toEqual(['payment-tab-plugin']);
  });

  it('the host gate (backend module, right) decides on top of the switch', () => {
    const activeModules = new Set(['stripe']);
    const { active, unknown } = selectPlugins(
      BUILT,
      { 'payment-base': {}, stripe: {}, 'admin-assistant': {}, analytics: { enabled: false } },
      (entry) => entry.module === undefined || activeModules.has(entry.module),
    );
    expect(active.map((entry) => entry.name)).toEqual(['payment-base', 'stripe']);
    expect(unknown).toEqual([]);
  });

  it('switched off: the plugin is not selected even when the gate would allow it', () => {
    expect(
      selectPlugins(BUILT, ['analytics'], () => true).active.map((entry) => entry.name),
    ).toEqual(['analytics']);
    expect(selectPlugins(BUILT, [], () => true)).toEqual({ active: [], unknown: [] });
  });
});
