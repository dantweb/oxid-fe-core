import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/events/EventBus';

describe('EventBus', () => {
  it('delivers payloads to subscribers', () => {
    const bus = new EventBus();
    const seen: unknown[] = [];
    bus.on<number>('tick', (n) => seen.push(n));

    bus.emit('tick', 1);
    bus.emit('tick', 2);

    expect(seen).toEqual([1, 2]);
  });

  it('unsubscribes via the returned function and via off', () => {
    const bus = new EventBus();
    let count = 0;
    const handler = (): number => count++;
    const unsubscribe = bus.on('e', handler);

    bus.emit('e');
    unsubscribe();
    bus.emit('e');
    expect(count).toBe(1);

    bus.on('e', handler);
    bus.off('e', handler);
    bus.emit('e');
    expect(count).toBe(1);
  });

  it('once fires a single time', () => {
    const bus = new EventBus();
    let count = 0;
    bus.once('e', () => count++);

    bus.emit('e');
    bus.emit('e');

    expect(count).toBe(1);
  });

  it('emitting an event without subscribers is a no-op', () => {
    expect(() => new EventBus().emit('nobody-listens')).not.toThrow();
  });
});
