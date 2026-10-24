import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * zod 4 compiles object parsers with `new Function`, which a CSP without 'unsafe-eval' / Trusted Types refuses
 * and reports. Core's schemas are created at import time, so the host calls `configureZodForCsp()` first.
 */
async function parseWithFreshModules(configure: boolean): Promise<number> {
  vi.resetModules();
  const zod = await import('zod');
  zod.z.config({ jitless: false });
  if (configure) {
    const { configureZodForCsp } = await import('../../src/validation/zodCsp');
    configureZodForCsp();
  }
  const calls: unknown[] = [];
  const RealFunction = globalThis.Function;
  const Spy = new Proxy(RealFunction, {
    construct(target, args, newTarget) {
      calls.push(args);
      return Reflect.construct(target, args, newTarget);
    },
  });
  vi.stubGlobal('Function', Spy);
  try {
    const { addressSchema } = await import('../../src/validation/address');
    const { themeConfigSchema } = await import('../../src/theme/types');
    addressSchema.safeParse({});
    themeConfigSchema.parse({ id: 'a', name: 'A' });
  } finally {
    vi.unstubAllGlobals();
  }
  return calls.length;
}

describe('configureZodForCsp', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('without it zod compiles parsers with new Function (the premise)', async () => {
    expect(await parseWithFreshModules(false)).toBeGreaterThan(0);
  });

  it("with it core's own schemas never trigger new Function", async () => {
    expect(await parseWithFreshModules(true)).toBe(0);
  });
});

describe('zod-csp entry', () => {
  it('imports nothing but zod, so it can run before any schema exists', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/validation/zodCsp.ts', 'utf8');
    const imports = [...source.matchAll(/^import .* from '(.+)';$/gm)].map((match) => match[1]);
    expect(imports).toEqual(['zod']);
  });
});
