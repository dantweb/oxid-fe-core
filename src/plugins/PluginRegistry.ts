import type { RouteRecordRaw } from 'vue-router';
import { isPaymentPlugin, type PaymentPlugin } from './payment';
import type { IPlugin, NavItem, OverrideSlot, PluginContext, ViewLoader } from './types';

interface RegisteredPlugin {
  plugin: IPlugin;
  config: Record<string, unknown>;
}

/**
 * Collects plugins and hands the host their aggregated contributions.
 * The registry never touches the router, i18n or pinia itself — the host
 * applies `routes`, `navItems` and `messagesFor()` where they belong.
 */
export class PluginRegistry {
  private readonly plugins = new Map<string, RegisteredPlugin>();

  register(plugin: IPlugin, configOverrides: Record<string, unknown> = {}): void {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`Plugin "${plugin.name}" is already registered`);
    }
    this.plugins.set(plugin.name, {
      plugin,
      config: { ...plugin.defaultConfig, ...configOverrides },
    });
  }

  has(name: string): boolean {
    return this.plugins.has(name);
  }

  all(): IPlugin[] {
    return [...this.plugins.values()].map((entry) => entry.plugin);
  }

  configOf(name: string): Record<string, unknown> {
    return this.plugins.get(name)?.config ?? {};
  }

  get routes(): RouteRecordRaw[] {
    return this.all().flatMap((plugin) => plugin.routes ?? []);
  }

  /**
   * The view a plugin supplies for a host slot, or null for the host's own. With several
   * overriding plugins the one registered last wins (= listed last in the instance config).
   */
  overrideFor(slot: OverrideSlot): ViewLoader | null {
    let found: ViewLoader | null = null;
    for (const plugin of this.all()) {
      found = plugin.overrides?.[slot] ?? found;
    }
    return found;
  }

  /** The global components of all plugins (see `IPlugin.overlays`), in registration order. */
  overlays(): ViewLoader[] {
    return this.all().flatMap((plugin) => plugin.overlays ?? []);
  }

  /** The theme the first plugin declaring one brings along, if any. */
  defaultTheme(): string | null {
    return this.all().find((plugin) => plugin.defaultTheme)?.defaultTheme ?? null;
  }

  /** Throws a clear error when a plugin's `requires` names a plugin that is not registered. */
  validateRequirements(): void {
    for (const plugin of this.all()) {
      for (const required of plugin.requires ?? []) {
        if (!this.has(required)) {
          throw new Error(`plugin "${plugin.name}" requires "${required}", which is not enabled`);
        }
      }
    }
  }

  get paymentPlugins(): PaymentPlugin[] {
    return this.all().filter(isPaymentPlugin);
  }

  /** The payment plugin handling this OXID payment id, if one is installed. */
  paymentPluginFor(paymentId: string): PaymentPlugin | null {
    return this.paymentPlugins.find((plugin) => plugin.paymentId === paymentId) ?? null;
  }

  get navItems(): NavItem[] {
    return this.all()
      .flatMap((plugin) => plugin.navItems ?? [])
      .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
  }

  /**
   * The navigation as a tree, sorted by `order` at every level and cut down to what `hasRight`
   * allows: an item whose `requiredRight` is refused goes with its children, and a group whose
   * children are all gone goes too. The plugins' own items are not modified.
   */
  navTree(hasRight: (right: string) => boolean): NavItem[] {
    return filterNav(this.navItems, hasRight);
  }

  /** Message tree for one locale: { <pluginName>: <plugin messages> }. */
  messagesFor(locale: string): Record<string, unknown> {
    const merged: Record<string, unknown> = {};
    for (const { plugin } of this.plugins.values()) {
      const messages = plugin.messages?.[locale];
      if (messages) {
        merged[plugin.name] = messages;
      }
    }
    return merged;
  }

  /** Runs every plugin's setup with its merged config. */
  async setupAll(base: Omit<PluginContext, 'config'>): Promise<void> {
    this.validateRequirements();
    for (const { plugin, config } of this.plugins.values()) {
      await plugin.setup?.({ ...base, config });
    }
  }
}

function filterNav(items: NavItem[], hasRight: (right: string) => boolean): NavItem[] {
  return [...items]
    .sort((a, b) => (a.order ?? 100) - (b.order ?? 100))
    .flatMap((item) => {
      if (item.requiredRight !== undefined && !hasRight(item.requiredRight)) {
        return [];
      }
      if (!item.children) {
        return [item];
      }
      const children = filterNav(item.children, hasRight);
      return children.length > 0 ? [{ ...item, children }] : [];
    });
}
