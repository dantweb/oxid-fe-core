import { defineComponent, h, ref } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from 'vue';
import {
  languageName,
  LOCALE_STORAGE_KEY,
  localeSwitchKey,
  useLocaleSwitch,
  type LocaleSwitchSource,
} from '../../src/i18n/localeSwitch';

/** Runs the composable inside a component with the given provider. */
function withProvider(
  source: LocaleSwitchSource | null,
  storage: Storage | null | undefined,
  reload: () => void = () => undefined,
) {
  let result: ReturnType<typeof useLocaleSwitch> | undefined;
  let error: unknown;
  const Probe = defineComponent({
    setup() {
      try {
        result = useLocaleSwitch({ storage, reload });
      } catch (cause) {
        error = cause;
      }
      return () => h('div');
    },
  });
  const app = createApp(Probe);
  if (source) {
    app.provide(localeSwitchKey, source);
  }
  app.mount(document.createElement('div'));
  return { result, error };
}

describe('useLocaleSwitch', () => {
  it('exposes the host-provided ordered list and the live locale', () => {
    const locale = ref('en');
    const { result } = withProvider({ locale, locales: ['en', 'de', 'fr'] }, null);

    expect(result?.locales).toEqual(['en', 'de', 'fr']);
    expect(result?.locale.value).toBe('en');
    locale.value = 'fr';
    expect(result?.locale.value).toBe('fr');
  });

  it('switchTo sets the locale and stores the choice under the key the host reads at boot', () => {
    const locale = ref('en');
    const storage = { setItem: vi.fn() } as unknown as Storage & {
      setItem: ReturnType<typeof vi.fn>;
    };
    const reload = vi.fn();
    const { result } = withProvider({ locale, locales: ['en', 'de'] }, storage, reload);

    result?.switchTo('de');

    expect(locale.value).toBe('de');
    expect(storage.setItem).toHaveBeenCalledWith(LOCALE_STORAGE_KEY, 'de');
    expect(reload).toHaveBeenCalledOnce(); // the page starts over in the new language (shop content follows)
    expect(storage.setItem.mock.invocationCallOrder[0]).toBeLessThan(
      reload.mock.invocationCallOrder[0],
    );
    expect(LOCALE_STORAGE_KEY).toBe('oxfe_locale'); // pinned: a change would drop every stored choice
  });

  it('refuses a locale the instance does not offer', () => {
    const locale = ref('en');
    const storage = { setItem: vi.fn() } as unknown as Storage;
    const reload = vi.fn();
    const { result } = withProvider({ locale, locales: ['en', 'de'] }, storage, reload);

    result?.switchTo('xx');

    expect(locale.value).toBe('en');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('survives a storage that throws (private mode): the switch still happens for this page', () => {
    const locale = ref('en');
    const storage = {
      setItem: () => {
        throw new DOMException('denied');
      },
    } as unknown as Storage;
    const { result } = withProvider({ locale, locales: ['en', 'de'] }, storage);

    result?.switchTo('de');

    expect(locale.value).toBe('de');
  });

  it('fails loudly when the host did not provide the source', () => {
    const { error } = withProvider(null, null);
    expect(String(error)).toMatch(/localeSwitchKey/);
  });
});

describe('languageName', () => {
  it("gives the language's own name", () => {
    expect(languageName('de')).toBe('Deutsch');
    expect(languageName('en')).toBe('English');
    expect(languageName('fr')).toBe('Français');
  });

  it('falls back to the upper-cased code for an unknown or unsupported code', () => {
    expect(languageName('xx')).toBe('XX');
    expect(languageName('de', null)).toBe('DE'); // no Intl.DisplayNames in this browser
  });
});
