export type EventHandler<T = unknown> = (payload: T) => void;

/** Event names the core itself emits. Plugins may define their own. */
export const CoreEvents = {
  AuthLogin: 'auth:login',
  AuthLogout: 'auth:logout',
  SessionExpired: 'auth:session-expired',
} as const;

/**
 * Minimal pub/sub bus decoupling host, core services and plugins.
 */
export class EventBus {
  private readonly handlers = new Map<string, Set<EventHandler<never>>>();

  /** Returns an unsubscribe function. */
  on<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler as EventHandler<never>);
    this.handlers.set(event, set);
    return () => this.off(event, handler);
  }

  once<T = unknown>(event: string, handler: EventHandler<T>): () => void {
    const unsubscribe = this.on<T>(event, (payload) => {
      unsubscribe();
      handler(payload);
    });
    return unsubscribe;
  }

  off<T = unknown>(event: string, handler: EventHandler<T>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<never>);
  }

  emit<T = unknown>(event: string, payload?: T): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    for (const handler of [...set]) {
      (handler as EventHandler<T | undefined>)(payload);
    }
  }
}
