import type { Component } from 'vue';
import type { RouteRecordRaw } from 'vue-router';
import type { GraphqlClient } from '../api/GraphqlClient';
import type { AuthService } from '../auth/AuthService';
import type { EventBus } from '../events/EventBus';
import type { PluginRegistry } from './PluginRegistry';

/** The slots of the storefront layout. */
export const STOREFRONT_SLOTS = { header: 'header', footer: 'footer', home: 'home' } as const;
export type StorefrontSlot = (typeof STOREFRONT_SLOTS)[keyof typeof STOREFRONT_SLOTS];

/**
 * A part of a host's default layout a plugin can take over. Any string: a host defines its own
 * (`topbar`, `dashboard`, `entityTabs:<entity>`) and narrows the type with the generic parameter of
 * `IPlugin` / `PluginRegistry` (the storefront uses {@link StorefrontSlot}).
 */
export type OverrideSlot = string;

export type ViewLoader = () => Promise<{ default: Component }>;

export interface NavItem {
  /** i18n key, resolved by the host's vue-i18n instance. */
  labelKey: string;
  to: string;
  order?: number;
  requiresAuth?: boolean;
  /** Right the user must hold to see the item (see `PluginRegistry.navTree`). */
  requiredRight?: string;
  /** Sub-items: the item is a group, shown only while one of its children is. */
  children?: NavItem[];
  /** Free-form grouping label for the host's navigation (i18n key); passed through untouched. */
  section?: string;
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
export interface IPlugin<TSlot extends string = OverrideSlot> {
  name: string;
  version: string;
  routes?: RouteRecordRaw[];
  navItems?: NavItem[];
  /** locale → message subtree, merged into the host i18n under the plugin name. */
  messages?: Record<string, Record<string, unknown>>;
  defaultConfig?: Record<string, unknown>;
  /** Views this plugin takes over from the host's defaults (layout plugins). */
  overrides?: Partial<Record<TSlot, ViewLoader>>;
  /**
   * Global components rendered once next to the host's layout, on every page (cookie consent,
   * notification banners, chat widgets …). Each manages its own visibility.
   */
  overlays?: ViewLoader[];
  /** Plugins that must be enabled for this one to work; checked at boot. */
  requires?: string[];
  /** The theme this plugin brings along; applies when the instance names no theme itself. */
  defaultTheme?: string;
  setup?(context: PluginContext): void | Promise<void>;
}
