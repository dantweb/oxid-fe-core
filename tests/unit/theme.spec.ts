import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, clearTheme } from '../../src/theme/applyTheme';
import { loadTheme, THEME_STYLESHEET_ID } from '../../src/theme/loadTheme';
import { themeConfigSchema } from '../../src/theme/types';

describe('applyTheme / clearTheme', () => {
  beforeEach(() => document.documentElement.removeAttribute('style'));

  it('sets the tokens as custom properties on the root element', () => {
    applyTheme({ tokens: { '--oxfe-color-primary': '#123456', '--oxfe-radius-md': '2px' } });

    const style = document.documentElement.style;
    expect(style.getPropertyValue('--oxfe-color-primary')).toBe('#123456');
    expect(style.getPropertyValue('--oxfe-radius-md')).toBe('2px');
  });

  it('clearTheme removes exactly what was applied and leaves other properties alone', () => {
    document.documentElement.style.setProperty('--other', 'keep');
    const theme = { tokens: { '--oxfe-color-primary': '#123456' } };
    applyTheme(theme);

    clearTheme(theme);

    expect(document.documentElement.style.getPropertyValue('--oxfe-color-primary')).toBe('');
    expect(document.documentElement.style.getPropertyValue('--other')).toBe('keep');
  });
});

describe('themeConfigSchema', () => {
  it('requires id and name and defaults tokens/images', () => {
    const config = themeConfigSchema.parse({ id: 'x', name: 'X' });
    expect(config.tokens).toEqual({});
    expect(config.images).toEqual({});
    expect(() => themeConfigSchema.parse({ id: 'x' })).toThrow();
  });
});

function themeServer(files: Record<string, unknown>): typeof fetch {
  return vi.fn(async (url: RequestInfo | URL) => {
    const body = files[String(url)];
    return body === undefined
      ? new Response('not found', { status: 404 })
      : new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

const defaultTheme = {
  id: 'default',
  name: 'Default',
  parent: null,
  tokens: { '--oxfe-color-primary': '#0a5d9c', '--oxfe-color-background': '#ffffff' },
  images: { logo: 'logo.png' },
};
const darkTheme = {
  id: 'dark',
  name: 'Dark',
  parent: 'default',
  tokens: { '--oxfe-color-background': '#121212' },
  images: {},
};

describe('loadTheme', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('style');
    document.getElementById(THEME_STYLESHEET_ID)?.remove();
  });

  it('loads the active theme, merges the parent chain (child wins) and attaches the stylesheet', async () => {
    const fetchFn = themeServer({
      '/themes/dark/config.json': darkTheme,
      '/themes/default/config.json': defaultTheme,
    });

    const theme = await loadTheme({
      active: 'dark',
      fallback: 'default',
      fetchFn,
      stylesheetTimeoutMs: 5,
    });

    expect(theme?.id).toBe('dark');
    expect(theme?.tokens).toEqual({
      '--oxfe-color-primary': '#0a5d9c', // inherited from the parent
      '--oxfe-color-background': '#121212', // overridden by the child
    });
    // an image lives in the folder of the theme that declares it
    expect(theme?.images.logo).toBe('/themes/default/images/logo.png');
    expect(document.documentElement.style.getPropertyValue('--oxfe-color-background')).toBe(
      '#121212',
    );
    const link = document.getElementById(THEME_STYLESHEET_ID) as HTMLLinkElement;
    expect(link.getAttribute('href')).toBe('/themes/dark/styles/styles.css');
  });

  it('falls back to the default theme when the active one cannot be loaded', async () => {
    const fetchFn = themeServer({ '/themes/default/config.json': defaultTheme });

    const theme = await loadTheme({
      active: 'typo',
      fallback: 'default',
      fetchFn,
      stylesheetTimeoutMs: 5,
    });

    expect(theme?.id).toBe('default');
  });

  it('returns null when nothing loads, leaving the page on the component fallbacks', async () => {
    const theme = await loadTheme({
      active: 'a',
      fallback: 'b',
      fetchFn: themeServer({}),
      stylesheetTimeoutMs: 5,
    });

    expect(theme).toBeNull();
    expect(document.getElementById(THEME_STYLESHEET_ID)).toBeNull();
  });

  it('rejects a config.json whose id does not match its folder, and cyclic parents', async () => {
    const mismatch = themeServer({ '/themes/x/config.json': { ...defaultTheme, id: 'y' } });
    expect(
      await loadTheme({ active: 'x', fallback: 'x', fetchFn: mismatch, stylesheetTimeoutMs: 5 }),
    ).toBeNull();

    const cycle = themeServer({
      '/themes/a/config.json': { id: 'a', name: 'A', parent: 'b' },
      '/themes/b/config.json': { id: 'b', name: 'B', parent: 'a' },
    });
    expect(
      await loadTheme({ active: 'a', fallback: 'a', fetchFn: cycle, stylesheetTimeoutMs: 5 }),
    ).toBeNull();
  });

  it('replaces a previously attached theme stylesheet', async () => {
    const fetchFn = themeServer({ '/themes/default/config.json': defaultTheme });
    const options = { active: 'default', fallback: 'default', fetchFn, stylesheetTimeoutMs: 5 };

    await loadTheme(options);
    await loadTheme(options);

    expect(document.querySelectorAll(`#${THEME_STYLESHEET_ID}`)).toHaveLength(1);
  });
});
