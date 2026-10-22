export interface AbortGuard {
  /** What goes to `fetch`; undefined when the call neither has a signal nor a timeout. */
  readonly signal: AbortSignal | undefined;
  /** The abort was this guard's timeout, not the caller. */
  timedOut(): boolean;
  /** Clears the timer and the listener on the caller's signal. */
  dispose(): void;
}

/** Joins a caller's `AbortSignal` and an optional timeout into the one signal a request listens to. */
export function createAbortGuard(signal?: AbortSignal, timeoutMs?: number): AbortGuard {
  if (signal === undefined && timeoutMs === undefined) {
    return { signal: undefined, timedOut: () => false, dispose: () => undefined };
  }
  const controller = new AbortController();
  let timedOut = false;
  const onCallerAbort = (): void => controller.abort(signal?.reason);
  if (signal?.aborted) {
    onCallerAbort();
  }
  signal?.addEventListener('abort', onCallerAbort);
  const timer =
    timeoutMs === undefined
      ? null
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      if (timer !== null) {
        clearTimeout(timer);
      }
      signal?.removeEventListener('abort', onCallerAbort);
    },
  };
}
