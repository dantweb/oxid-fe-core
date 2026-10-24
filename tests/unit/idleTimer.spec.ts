import { describe, expect, it, vi } from 'vitest';
import { createIdleTimer, type IdleTimerOptions } from '../../src/session/idleTimer';
import { fakeChannelPair, fakeClock } from '../helpers/idle';

const MINUTE = 60_000;

function setup(overrides: Partial<IdleTimerOptions> = {}) {
  const clock = fakeClock();
  const target = new EventTarget();
  const onWarn = vi.fn();
  const onTimeout = vi.fn();
  const onResume = vi.fn();
  const timer = createIdleTimer({
    timeoutMs: 10 * MINUTE,
    warnMs: 2 * MINUTE,
    events: ['mousemove', 'keydown'],
    target,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    throttleMs: 1000,
    onWarn,
    onTimeout,
    onResume,
    ...overrides,
  });
  const activity = (type = 'mousemove') => target.dispatchEvent(new Event(type));
  return { clock, target, timer, onWarn, onTimeout, onResume, activity };
}

describe('createIdleTimer', () => {
  it('rejects a timeout that is not positive', () => {
    expect(() => createIdleTimer({ timeoutMs: 0 })).toThrow(RangeError);
    expect(() => createIdleTimer({ timeoutMs: Number.NaN })).toThrow(RangeError);
  });

  it('warns warnMs before the timeout and then times out', () => {
    const { clock, timer, onWarn, onTimeout } = setup();
    timer.start();

    clock.advance(8 * MINUTE - 1);
    expect(onWarn).not.toHaveBeenCalled();

    clock.advance(1);
    expect(onWarn).toHaveBeenCalledWith(2 * MINUTE);
    expect(onTimeout).not.toHaveBeenCalled();

    clock.advance(2 * MINUTE);
    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onWarn).toHaveBeenCalledOnce();
  });

  it('times out without a warning when warnMs is not given', () => {
    const { clock, timer, onWarn, onTimeout } = setup({ warnMs: undefined });
    timer.start();

    clock.advance(10 * MINUTE);

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(onWarn).not.toHaveBeenCalled();
  });

  it('warns at once when warnMs is not smaller than the timeout', () => {
    const { clock, timer, onWarn } = setup({ warnMs: 20 * MINUTE });
    timer.start();

    clock.advance(0);

    expect(onWarn).toHaveBeenCalledWith(10 * MINUTE);
  });

  it('activity postpones the warning and the timeout', () => {
    const { clock, timer, onWarn, onTimeout, activity } = setup();
    timer.start();

    clock.advance(7 * MINUTE);
    activity('keydown');
    clock.advance(7 * MINUTE);
    expect(onWarn).not.toHaveBeenCalled();

    clock.advance(MINUTE);
    expect(onWarn).toHaveBeenCalledOnce();
    clock.advance(2 * MINUTE);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('throttles activity: events inside the window do not move the deadline', () => {
    const { clock, timer, onTimeout, activity } = setup({ warnMs: undefined });
    timer.start();

    clock.advance(5 * MINUTE);
    activity(); // counts
    clock.advance(500);
    activity(); // inside the 1 s window: ignored
    clock.advance(10 * MINUTE - 500);

    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('ignores local activity once the warning is out; reset() is the way back', () => {
    const { clock, timer, onWarn, onTimeout, onResume, activity } = setup();
    timer.start();
    clock.advance(8 * MINUTE);
    expect(onWarn).toHaveBeenCalledOnce();

    activity(); // a mouse twitch must not silently dismiss the dialog
    clock.advance(MINUTE);
    expect(onResume).not.toHaveBeenCalled();

    timer.reset();
    expect(onResume).toHaveBeenCalledOnce();
    clock.advance(10 * MINUTE - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    clock.advance(1);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('survives a throttled or slept timer: it judges by the clock, not by the callback', () => {
    const { clock, timer, onTimeout } = setup({ warnMs: undefined });
    timer.start();

    // the machine slept: the timer fires late, past the deadline
    clock.advance(10 * MINUTE + 5 * MINUTE);

    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('reports the remaining time', () => {
    const { clock, timer } = setup();
    timer.start();

    clock.advance(3 * MINUTE);
    expect(timer.remainingMs()).toBe(7 * MINUTE);

    clock.advance(20 * MINUTE);
    expect(timer.remainingMs()).toBe(0);
  });

  it('stop() cancels the timer and detaches the listeners', () => {
    const { clock, timer, target, onTimeout } = setup();
    const removed = vi.spyOn(target, 'removeEventListener');
    timer.start();

    timer.stop();
    clock.advance(30 * MINUTE);

    expect(onTimeout).not.toHaveBeenCalled();
    expect(clock.pending()).toBe(0);
    expect(removed).toHaveBeenCalledTimes(2);
  });

  it('start() twice does not double the listeners or timers', () => {
    const { clock, timer, onTimeout } = setup({ warnMs: undefined });
    timer.start();
    timer.start();

    clock.advance(10 * MINUTE);

    expect(onTimeout).toHaveBeenCalledOnce();
    expect(clock.pending()).toBe(0);
  });

  it('can be started again after a timeout', () => {
    const { clock, timer, onTimeout } = setup({ warnMs: undefined });
    timer.start();
    clock.advance(10 * MINUTE);

    timer.start();
    clock.advance(10 * MINUTE);

    expect(onTimeout).toHaveBeenCalledTimes(2);
  });

  it('reset() while stopped does nothing', () => {
    const { clock, timer } = setup();

    timer.reset();

    expect(clock.pending()).toBe(0);
  });
});

describe('createIdleTimer across tabs', () => {
  function twoTabs() {
    const [channelA, channelB] = fakeChannelPair();
    const clock = fakeClock();
    const a = setup({
      channel: channelA,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    const b = setup({
      channel: channelB,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
    });
    a.timer.start();
    b.timer.start();
    return { clock, a, b };
  }

  it('activity in one tab postpones the timeout in the other', () => {
    const { clock, a, b } = twoTabs();

    clock.advance(7 * MINUTE);
    a.activity();
    clock.advance(7 * MINUTE);

    expect(b.onWarn).not.toHaveBeenCalled();
    expect(b.timer.remainingMs()).toBe(3 * MINUTE);
  });

  it('activity elsewhere dismisses an open warning', () => {
    const { clock, a, b } = twoTabs();
    clock.advance(8 * MINUTE);
    expect(b.onWarn).toHaveBeenCalledOnce();

    a.timer.reset();

    expect(b.onResume).toHaveBeenCalledOnce();
  });

  it('a timeout in one tab times the other out at once', () => {
    const [channelA, channelB] = fakeChannelPair();
    const clockA = fakeClock();
    const a = setup({
      channel: channelA,
      now: clockA.now,
      setTimer: clockA.setTimer,
      clearTimer: clockA.clearTimer,
      warnMs: undefined,
    });
    const clockB = fakeClock();
    const b = setup({
      channel: channelB,
      now: clockB.now,
      setTimer: clockB.setTimer,
      clearTimer: clockB.clearTimer,
      warnMs: undefined,
    });
    a.timer.start();
    b.timer.start();

    clockA.advance(10 * MINUTE);

    expect(a.onTimeout).toHaveBeenCalledOnce();
    expect(b.onTimeout).toHaveBeenCalledOnce();
    expect(clockB.pending()).toBe(0);
  });

  it('does not echo what it received', () => {
    const [channelA, channelB] = fakeChannelPair();
    const clock = fakeClock();
    const shared = { now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer };
    const a = setup({ channel: channelA, ...shared });
    const b = setup({ channel: channelB, ...shared });
    a.timer.start();
    b.timer.start();
    const sentByA = vi.spyOn(channelA, 'postMessage');

    b.timer.reset();

    expect(sentByA).not.toHaveBeenCalled();
  });

  it('ignores messages that are not its own protocol', () => {
    const [channelA, channelB] = fakeChannelPair();
    const clock = fakeClock();
    const a = setup({
      channel: channelA,
      now: clock.now,
      setTimer: clock.setTimer,
      clearTimer: clock.clearTimer,
      warnMs: undefined,
    });
    a.timer.start();

    channelB.postMessage('hello');
    channelB.postMessage({ type: 'something-else' });
    channelB.postMessage(null);
    clock.advance(10 * MINUTE);

    expect(a.onTimeout).toHaveBeenCalledOnce();
  });

  it('stop() detaches from the channel', () => {
    const { clock, a, b } = twoTabs();
    a.timer.stop();

    b.timer.reset();
    clock.advance(30 * MINUTE);

    expect(a.onTimeout).not.toHaveBeenCalled();
  });
});
