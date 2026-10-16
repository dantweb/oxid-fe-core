import { describe, expect, it } from 'vitest';
import { loadScriptOnce } from '../../src/utils/script';

/** A document that records appended scripts instead of fetching them. */
class FakeScript extends EventTarget {
  src = '';
  async = false;
  removed = false;
  readonly attributes: Record<string, string> = {};

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  remove(): void {
    this.removed = true;
  }
}

function fakeDocument(): { doc: Document; scripts: FakeScript[] } {
  const scripts: FakeScript[] = [];
  const doc = {
    createElement: () => new FakeScript(),
    head: { appendChild: (script: FakeScript) => scripts.push(script) },
  } as unknown as Document;
  return { doc, scripts };
}

describe('loadScriptOnce', () => {
  it('appends one async script with the given attributes and resolves on load', async () => {
    const { doc, scripts } = fakeDocument();
    const promise = loadScriptOnce('https://sdk.example/one.js', { 'data-sdk': 'x' }, doc);

    expect(scripts).toHaveLength(1);
    expect(scripts[0].src).toBe('https://sdk.example/one.js');
    expect(scripts[0].async).toBe(true);
    expect(scripts[0].attributes['data-sdk']).toBe('x');

    scripts[0].dispatchEvent(new Event('load'));
    await expect(promise).resolves.toBeUndefined();
  });

  it('shares one load between callers — however many components ask', async () => {
    const { doc, scripts } = fakeDocument();
    const first = loadScriptOnce('https://sdk.example/shared.js', {}, doc);
    const second = loadScriptOnce('https://sdk.example/shared.js', {}, doc);

    expect(first).toBe(second);
    expect(scripts).toHaveLength(1);
    scripts[0].dispatchEvent(new Event('load'));
    await Promise.all([first, second]);
  });

  it('rejects when the script cannot load, removes it, and allows a retry', async () => {
    const { doc, scripts } = fakeDocument();
    const url = 'https://sdk.example/broken.js';
    const failed = loadScriptOnce(url, {}, doc);
    scripts[0].dispatchEvent(new Event('error'));

    await expect(failed).rejects.toThrow(`could not load ${url}`);
    expect(scripts[0].removed).toBe(true);

    const retry = loadScriptOnce(url, {}, doc);
    expect(scripts).toHaveLength(2);
    scripts[1].dispatchEvent(new Event('load'));
    await expect(retry).resolves.toBeUndefined();
  });
});
