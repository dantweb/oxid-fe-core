/**
 * Switching plugins on and off, the same for every frontend on this core. An instance config names the plugins it
 * wants, in one of two shapes:
 *
 * - a list: `['payment-base', 'analytics']` (oxid-fe-admin `admin.plugins_enabled`);
 * - a map: `{ cms: {}, reviews: { enabled: false } }` (oxid-fe-user `plugins`; `enabled` defaults to true).
 *
 * The host passes the plugins its build carries; `selectPlugins` answers which of them run (switched on AND allowed
 * by the host's gate — a backend module, a right) and which switched-on names no plugin carries (to report).
 */
export type PluginSwitches =
  readonly string[] | Readonly<Record<string, { readonly enabled?: boolean }>>;

/** Whether a plugin may run besides being switched on (the backend module is active, the user holds a right, …). */
export type PluginGate<TPlugin> = (plugin: TPlugin) => boolean;

export interface PluginSelection<TPlugin> {
  /** The plugins that run, in build order (a plugin's `requires` must come before it). */
  active: TPlugin[];
  /** Switched-on names that no plugin of the build carries: a typo, or an id renamed in a release. */
  unknown: string[];
}

/** The switched-on plugin names, in config order, each once. */
export function enabledPluginNames(switches: PluginSwitches): string[] {
  const names = isList(switches)
    ? switches
    : Object.entries(switches)
        .filter(([, entry]) => entry.enabled !== false)
        .map(([name]) => name);
  return [...new Set(names)];
}

export function isPluginEnabled(name: string, switches: PluginSwitches): boolean {
  return enabledPluginNames(switches).includes(name);
}

/** The plugins that run and the switched-on names nobody carries; without a gate, switched on is enough. */
export function selectPlugins<TPlugin extends { readonly name: string }>(
  available: readonly TPlugin[],
  switches: PluginSwitches,
  gate: PluginGate<TPlugin> = () => true,
): PluginSelection<TPlugin> {
  const enabled = new Set(enabledPluginNames(switches));
  const carried = new Set(available.map((plugin) => plugin.name));
  return {
    active: available.filter((plugin) => enabled.has(plugin.name) && gate(plugin)),
    unknown: [...enabled].filter((name) => !carried.has(name)),
  };
}

function isList(switches: PluginSwitches): switches is readonly string[] {
  return Array.isArray(switches);
}
