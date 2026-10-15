import type { RouteRecordRaw } from 'vue-router';
import { isPaymentPlugin, type PaymentPlugin } from './payment';
import type { IPlugin, NavItem, PluginContext } from './types';

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
    for (const { plugin, config } of this.plugins.values()) {
      await plugin.setup?.({ ...base, config });
    }
  }
}
