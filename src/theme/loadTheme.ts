import { applyTheme } from './applyTheme';
import { themeConfigSchema, type ResolvedTheme, type ThemeConfig } from './types';

export interface LoadThemeOptions {
  /** The theme this instance runs (oxid-config.yaml `theme.active`). */
  active: string;
  /** Used when `active` cannot be loaded (oxid-config.yaml `theme.default`). */
  fallback: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  document?: Document;
  /** How long to wait for the stylesheet before continuing without it. */
  stylesheetTimeoutMs?: number;
}

const MAX_PARENT_DEPTH = 5;
export const THEME_STYLESHEET_ID = 'oxfe-theme-css';

async function fetchConfig(
  id: string,
  baseUrl: string,
  fetchFn: typeof fetch,
): Promise<ThemeConfig> {
  const response = await fetchFn(`${baseUrl}/${id}/config.json`, { cache: 'no-cache' });
  if (!response.ok) {
    throw new Error(`theme "${id}": config.json answered ${response.status}`);
  }
  const config = themeConfigSchema.parse(await response.json());
  if (config.id !== id) {
    throw new Error(`theme "${id}": config.json declares id "${config.id}"`);
  }
  return config;
}

/** Walks `parent` links; tokens/images merge parent → child (child wins), like vbwd child themes. */
async function resolveChain(
  id: string,
  baseUrl: string,
  fetchFn: typeof fetch,
): Promise<{
  config: ThemeConfig;
  tokens: Record<string, string>;
  images: Record<string, string>;
}> {
  const chain: ThemeConfig[] = [];
  let current: string | null | undefined = id;
  while (current) {
    if (chain.length >= MAX_PARENT_DEPTH || chain.some((entry) => entry.id === current)) {
      throw new Error(`theme "${id}": parent chain too deep or cyclic`);
    }
    const config = await fetchConfig(current, baseUrl, fetchFn);
    chain.push(config);
    current = config.parent;
  }

  const tokens: Record<string, string> = {};
  const images: Record<string, string> = {};
  for (const config of [...chain].reverse()) {
    Object.assign(tokens, config.tokens);
    for (const [name, file] of Object.entries(config.images)) {
      // an image lives in the folder of the theme that declares it
      images[name] = `${baseUrl}/${config.id}/images/${file}`;
    }
  }
  return { config: chain[0], tokens, images };
}

function attachStylesheet(url: string, doc: Document, timeoutMs: number): Promise<void> {
  doc.getElementById(THEME_STYLESHEET_ID)?.remove();
  return new Promise((resolve) => {
    const link = doc.createElement('link');
    link.id = THEME_STYLESHEET_ID;
    link.rel = 'stylesheet';
    link.href = url;
    const done = (): void => resolve();
    link.addEventListener('load', done, { once: true });
    link.addEventListener('error', done, { once: true });
    setTimeout(done, timeoutMs);
    doc.head.appendChild(link);
  });
}

/**
 * Loads the instance's theme: tries `active`, then `fallback`; applies the merged tokens on
 * `:root` and attaches the stylesheet. Returns null when neither loads — the page then runs
 * on the components' `var(--oxfe-…, fallback)` defaults, i.e. the default look.
 */
export async function loadTheme(options: LoadThemeOptions): Promise<ResolvedTheme | null> {
  const baseUrl = options.baseUrl ?? '/themes';
  const fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  const doc = options.document ?? document;

  const candidates =
    options.active === options.fallback ? [options.active] : [options.active, options.fallback];
  for (const id of candidates) {
    try {
      const { config, tokens, images } = await resolveChain(id, baseUrl, fetchFn);
      const theme: ResolvedTheme = {
        id,
        name: config.name,
        tokens,
        images,
        stylesheetUrl: `${baseUrl}/${id}/styles/styles.css`,
      };
      applyTheme(theme, doc.documentElement);
      await attachStylesheet(theme.stylesheetUrl, doc, options.stylesheetTimeoutMs ?? 3000);
      return theme;
    } catch {
      continue;
    }
  }
  return null;
}
