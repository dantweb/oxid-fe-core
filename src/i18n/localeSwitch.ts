import { inject, type InjectionKey, type Ref } from 'vue';

/** Where the shopper's language choice is kept between visits. The host reads it at boot. */
export const LOCALE_STORAGE_KEY = 'oxfe_locale';

/** What the host provides: its live locale and the instance's ordered list of offered locales. */
export interface LocaleSwitchSource {
  locale: Ref<string>;
  locales: readonly string[];
}

export const localeSwitchKey: InjectionKey<LocaleSwitchSource> = Symbol('oxfe-locale-switch');

export interface LocaleSwitch {
  locale: Ref<string>;
  locales: readonly string[];
  /** Switches to an offered locale, remembers it and reloads the page; anything else is ignored. */
  switchTo(code: string): void;
}

export interface LocaleSwitchOptions {
  /** Where the choice is kept (default: localStorage; null keeps it for this page view only). */
  storage?: Storage | null;
  /** How the page is reloaded after the switch (default: the document). */
  reload?: () => void;
}

/**
 * The one way to change the storefront's language, for the host's and any plugin's switcher.
 * Core stays free of vue-i18n: the host provides its locale ref through `localeSwitchKey`.
 *
 * Like the shop's own language links, a switch reloads the page: every view then fetches its
 * shop content (products, categories, …) in the new language instead of keeping what it loaded
 * before. The choice is stored first, so the reloaded page starts in the chosen language.
 */
export function useLocaleSwitch(options: LocaleSwitchOptions = {}): LocaleSwitch {
  const source = inject(localeSwitchKey, null);
  if (!source) {
    throw new Error('useLocaleSwitch: the host must provide localeSwitchKey');
  }
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const reload = options.reload ?? reloadDocument;
  return {
    locale: source.locale,
    locales: source.locales,
    switchTo(code) {
      if (!source.locales.includes(code)) {
        return;
      }
      source.locale.value = code;
      try {
        storage?.setItem(LOCALE_STORAGE_KEY, code);
      } catch {
        /* the choice lasts for this page view */
      }
      reload();
    },
  };
}

type DisplayNamesFactory = typeof Intl.DisplayNames | null | undefined;

/** The language's own name ("Deutsch", "English"); the upper-cased code when the browser cannot say. */
export function languageName(
  code: string,
  displayNames: DisplayNamesFactory = Intl.DisplayNames,
): string {
  try {
    const name = displayNames ? new displayNames([code], { type: 'language' }).of(code) : undefined;
    if (!name || name === code) {
      return code.toUpperCase();
    }
    // CLDR spells some self-names in lower case ("français"); a menu entry starts with a capital
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1);
  } catch {
    return code.toUpperCase();
  }
}

function reloadDocument(): void {
  try {
    globalThis.location?.reload();
  } catch {
    /* not a browser (tests, SSR): the locale is switched in place */
  }
}

function defaultStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}
