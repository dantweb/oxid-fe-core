import type { IdleChannel } from '../../src/session/idleTimer';

/** A manual clock plus timer: `advance` moves time and fires what became due, in order. */
export function fakeClock(start = 1_000_000) {
  let current = start;
  let nextId = 1;
  const timers = new Map<number, { due: number; run: () => void }>();
  return {
    now: () => current,
    setTimer: (run: () => void, ms: number): number => {
      const id = nextId++;
      timers.set(id, { due: current + ms, run });
      return id;
    },
    clearTimer: (id: unknown): void => {
      timers.delete(id as number);
    },
    pending: () => timers.size,
    advance(ms: number): void {
      const target = current + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!due) {
          break;
        }
        timers.delete(due[0]);
        current = Math.max(current, due[1].due);
        due[1].run();
      }
      current = target;
    },
  };
}

/** Two linked channels, like two tabs on one BroadcastChannel name. */
export function fakeChannelPair(): [IdleChannel, IdleChannel] {
  const listeners: [
    Set<(event: { data: unknown }) => void>,
    Set<(event: { data: unknown }) => void>,
  ] = [new Set(), new Set()];
  const make = (self: 0 | 1) => ({
    postMessage(data: unknown): void {
      for (const listener of listeners[self === 0 ? 1 : 0]) {
        listener({ data });
      }
    },
    addEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
      listeners[self].add(listener);
    },
    removeEventListener(_type: 'message', listener: (event: { data: unknown }) => void): void {
      listeners[self].delete(listener);
    },
  });
  return [make(0), make(1)];
}
