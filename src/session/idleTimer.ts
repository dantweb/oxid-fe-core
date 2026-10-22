/** The part of `BroadcastChannel` the timer uses — inject a real one or a fake. */
export interface IdleChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
}

export interface IdleEventTarget {
  addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
  removeEventListener(type: string, listener: () => void, options?: EventListenerOptions): void;
}

export interface IdleTimerOptions {
  /** Idle time after which `onTimeout` fires. */
  timeoutMs: number;
  /** `onWarn` fires this long before the timeout. Omitted: no warning. */
  warnMs?: number;
  /** DOM events that count as activity. */
  events?: readonly string[];
  /** Where those events are listened for. Default: `document`. */
  target?: IdleEventTarget;
  /** Activity inside this window after the last one is not processed. Default 1000. */
  throttleMs?: number;
  /** Injected for tests; default `Date.now`. */
  now?: () => number;
  /** Injected for tests; default `setTimeout` / `clearTimeout`. */
  setTimer?: (run: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
  /**
   * Syncs several tabs: activity postpones the timeout everywhere, a timeout ends it everywhere.
   * Pass `new BroadcastChannel(name)`; the caller owns and closes it.
   */
  channel?: IdleChannel | null;
  /** Called with the milliseconds left when the warning is due. */
  onWarn?: (remainingMs: number) => void;
  /** Called when activity (here or in another tab) or `reset()` took an issued warning back. */
  onResume?: () => void;
  onTimeout?: () => void;
}

export interface IdleTimer {
  /** Begins counting from now and listens for activity; no-op while running. */
  start(): void;
  /** Stops counting and detaches every listener. */
  stop(): void;
  /** Counts as activity now — the "stay signed in" action; also takes an issued warning back. */
  reset(): void;
  remainingMs(): number;
}

const DEFAULT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'] as const;
const DEFAULT_THROTTLE_MS = 1000;
const ACTIVITY = 'idle:activity';
const TIMEOUT = 'idle:timeout';

type IdleMessage = { type: typeof ACTIVITY; at: number } | { type: typeof TIMEOUT };

/**
 * Counts idle time. Pure of globals: time, timers, event target and channel are injected, so it is
 * tested without a browser. Deadlines are judged by the clock, not by the timer callback, so a
 * throttled background tab or a sleeping machine still times out when it should.
 *
 * Once the warning is out, plain local activity (a twitching mouse) is ignored: only `reset()` or
 * activity in another tab takes it back.
 */
export function createIdleTimer(options: IdleTimerOptions): IdleTimer {
  const { timeoutMs, warnMs, onWarn, onResume, onTimeout } = options;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError('timeoutMs must be a positive number');
  }
  const events = options.events ?? DEFAULT_EVENTS;
  const throttleMs = options.throttleMs ?? DEFAULT_THROTTLE_MS;
  const now = options.now ?? Date.now;
  const setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as number));
  const channel = options.channel ?? null;

  let running = false;
  let warned = false;
  let lastActivity = now();
  let handle: unknown = null;
  let attachedTo: IdleEventTarget | null = null;

  const deadline = (): number => lastActivity + timeoutMs;
  const warnAt = (): number => (warnMs === undefined ? Infinity : deadline() - warnMs);

  function cancelTimer(): void {
    if (handle !== null) {
      clearTimer(handle);
      handle = null;
    }
  }

  function plan(): void {
    cancelTimer();
    const next = warned || warnMs === undefined ? deadline() : Math.min(warnAt(), deadline());
    handle = setTimer(check, Math.max(0, next - now()));
  }

  function check(): void {
    handle = null;
    const current = now();
    if (current >= deadline()) {
      finish(true);
      return;
    }
    if (!warned && current >= warnAt()) {
      warned = true;
      onWarn?.(deadline() - current);
    }
    plan();
  }

  function finish(announce: boolean): void {
    stop();
    if (announce) {
      send({ type: TIMEOUT });
    }
    onTimeout?.();
  }

  function activityAt(at: number): void {
    lastActivity = Math.max(lastActivity, at);
    if (warned) {
      warned = false;
      onResume?.();
    }
    plan();
  }

  function reset(): void {
    if (!running) {
      return;
    }
    const at = now();
    activityAt(at);
    send({ type: ACTIVITY, at });
  }

  function onLocalActivity(): void {
    if (warned || now() - lastActivity < throttleMs) {
      return;
    }
    reset();
  }

  function onMessage(event: { data: unknown }): void {
    const message = parseMessage(event.data);
    if (!message) {
      return;
    }
    if (message.type === TIMEOUT) {
      finish(false);
      return;
    }
    activityAt(message.at);
  }

  function send(message: IdleMessage): void {
    channel?.postMessage(message);
  }

  function start(): void {
    if (running) {
      return;
    }
    running = true;
    warned = false;
    lastActivity = now();
    const target = options.target ?? globalThis.document;
    attachedTo = target;
    for (const type of events) {
      target.addEventListener(type, onLocalActivity, { passive: true, capture: true });
    }
    channel?.addEventListener('message', onMessage);
    plan();
  }

  function stop(): void {
    if (!running) {
      return;
    }
    running = false;
    cancelTimer();
    for (const type of events) {
      attachedTo?.removeEventListener(type, onLocalActivity, { capture: true });
    }
    channel?.removeEventListener('message', onMessage);
  }

  return {
    start,
    stop,
    reset,
    remainingMs: () => Math.max(0, deadline() - now()),
  };
}

function parseMessage(data: unknown): IdleMessage | null {
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const { type, at } = data as { type?: unknown; at?: unknown };
  if (type === TIMEOUT) {
    return { type: TIMEOUT };
  }
  return type === ACTIVITY && typeof at === 'number' ? { type: ACTIVITY, at } : null;
}
