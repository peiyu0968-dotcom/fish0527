import type { BackendEvents, EventName, Unsubscribe } from './types';

type Handler<E extends EventName> = (payload: BackendEvents[E]) => void;

/** 很小的事件發送器：後端用它把事件推給畫面層。 */
export class Emitter {
  private handlers = new Map<EventName, Set<Handler<EventName>>>();

  on<E extends EventName>(event: E, handler: Handler<E>): Unsubscribe {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<EventName>);
    return () => {
      set?.delete(handler as Handler<EventName>);
    };
  }

  emit<E extends EventName>(event: E, payload: BackendEvents[E]): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }
}
