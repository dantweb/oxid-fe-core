import type { RouteRecordRaw } from 'vue-router';
import type { GraphqlClient } from '../api/GraphqlClient';
import type { AuthService } from '../auth/AuthService';
import type { EventBus } from '../events/EventBus';
import type { PluginRegistry } from './PluginRegistry';

export interface NavItem {
  /** i18n key, resolved by the host's vue-i18n instance. */
  labelKey: string;
  to: string;
  order?: number;
  requiresAuth?: boolean;
}

/** What a plugin's setup() receives from the host. */
export interface PluginContext {
  client: GraphqlClient;
  auth: AuthService;
  events: EventBus;
  /** The host's registry — lets a plugin find its peers (e.g. checkout → payment plugins). */
  registry: PluginRegistry;
  /** defaultConfig merged with the host's overrides for this plugin. */
  config: Record<string, unknown>;
}

/**
 * The contract between the host app and a plugin, modelled on
 * vbwd-fe-user's plugin anatomy: declarative routes/nav/i18n plus an
 * imperative setup for stores, event subscriptions and client wiring.
 */
export interface IPlugin {
  name: string;
  version: string;
  routes?: RouteRecordRaw[];
  navItems?: NavItem[];
  /** locale → message subtree, merged into the host i18n under the plugin name. */
  messages?: Record<string, Record<string, unknown>>;
  defaultConfig?: Record<string, unknown>;
  setup?(context: PluginContext): void | Promise<void>;
}
