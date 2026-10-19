import { describe, expect, it, vi } from 'vitest';
import { ResponseCache } from '../../src/api/ResponseCache';

function clockAt(start = 0) {
  let now = start;
  return { now: () => now, advance: (ms: number) => (now += ms) };
}

describe('ResponseCache', () => {
  it('loads on a miss and serves the stored value on a hit', async () => {
    const cache = new ResponseCache();
    const load = vi.fn().mockResolvedValue('A');

    expect(await cache.remember('k', 1000, load)).toBe('A');
    expect(await cache.remember('k', 1000, load)).toBe('A');

    expect(load).toHaveBeenCalledTimes(1);
  });

  it('keeps entries apart by key', async () => {
    const cache = new ResponseCache();

    await cache.remember('a', 1000, async () => 1);

    expect(await cache.remember('b', 1000, async () => 2)).toBe(2);
  });

  it('expires an entry exactly at its TTL', async () => {
    const clock = clockAt();
    const cache = new ResponseCache({ now: clock.now });
    const load = vi.fn().mockResolvedValueOnce('old').mockResolvedValueOnce('new');

    await cache.remember('k', 1000, load);
    clock.advance(999);
    expect(await cache.remember('k', 1000, load)).toBe('old');
    clock.advance(1);
    expect(await cache.remember('k', 1000, load)).toBe('new');
  });

  it('shares one load between concurrent identical requests', async () => {
    const cache = new ResponseCache();
    let resolve!: (value: string) => void;
    const load = vi.fn(() => new Promise<string>((done) => (resolve = done)));

    const first = cache.remember('k', 1000, load);
    const second = cache.remember('k', 1000, load);
    resolve('shared');

    expect(await first).toBe('shared');
    expect(await second).toBe('shared');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failure: the next call loads again', async () => {
    const cache = new ResponseCache();
    const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce('up');

    await expect(cache.remember('k', 1000, load)).rejects.toThrow('down');

    expect(await cache.remember('k', 1000, load)).toBe('up');
  });

  it('evicts the oldest entry beyond maxEntries', async () => {
    const cache = new ResponseCache({ maxEntries: 2 });
    const load = vi.fn(async () => 'v');

    await cache.remember('a', 1000, load);
    await cache.remember('b', 1000, load);
    await cache.remember('c', 1000, load); // evicts 'a'
    load.mockClear();

    await cache.remember('b', 1000, load);
    await cache.remember('c', 1000, load);
    expect(load).not.toHaveBeenCalled();
    await cache.remember('a', 1000, load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('clear() drops every entry', async () => {
    const cache = new ResponseCache();
    const load = vi.fn(async () => 'v');
    await cache.remember('k', 1000, load);

    cache.clear();
    await cache.remember('k', 1000, load);

    expect(load).toHaveBeenCalledTimes(2);
  });

  it('a load that was running while clear() was called is not stored (it may be stale)', async () => {
    const cache = new ResponseCache();
    let resolve!: (value: string) => void;
    const slow = cache.remember('k', 1000, () => new Promise<string>((done) => (resolve = done)));

    cache.clear();
    resolve('stale');
    expect(await slow).toBe('stale'); // the caller that asked still gets its answer

    const load = vi.fn(async () => 'fresh');
    expect(await cache.remember('k', 1000, load)).toBe('fresh');
  });
});
