import type { ThemeConfig } from './types';

type ThemeTokens = Pick<ThemeConfig, 'tokens'>;

/** Sets the theme's tokens as CSS custom properties on the root element (vbwd `applyTheme`). */
export function applyTheme(theme: ThemeTokens, root: HTMLElement = document.documentElement): void {
  for (const [property, value] of Object.entries(theme.tokens)) {
    root.style.setProperty(property, value);
  }
}

/** Removes what `applyTheme` set, restoring the component fallbacks (vbwd `clearTheme`). */
export function clearTheme(theme: ThemeTokens, root: HTMLElement = document.documentElement): void {
  for (const property of Object.keys(theme.tokens)) {
    root.style.removeProperty(property);
  }
}
