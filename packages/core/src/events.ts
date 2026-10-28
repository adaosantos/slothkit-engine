export type Listener<P> = (payload: P, tick: number) => void;

interface EventRecord<E> {
  type: keyof E;
  payload: E[keyof E];
}

/**
 * Per-tick event queue.
 *
 * Events emitted during a tick are readable by systems that run later in the
 * same tick. External listeners only receive them after the tick completes,
 * so a listener can never observe or change a half-finished tick.
 */
export class EventQueue<E> {
  #queue: EventRecord<E>[] = [];
  #listeners: Map<keyof E, Set<Listener<E[keyof E]>>> = new Map();

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    this.#queue.push({ type, payload });
  }

  read<K extends keyof E>(type: K): E[K][] {
    const out: E[K][] = [];
    for (const record of this.#queue) {
      if (record.type === type) out.push(record.payload as E[K]);
    }
    return out;
  }

  on<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
    let set = this.#listeners.get(type);
    if (!set) {
      set = new Set();
      this.#listeners.set(type, set);
    }
    const stored = listener as Listener<E[keyof E]>;
    set.add(stored);
    return () => {
      set.delete(stored);
    };
  }

  /** Delivers queued events to listeners and empties the queue. */
  flush(tick: number): void {
    const batch = this.#queue;
    this.#queue = [];
    for (const record of batch) {
      const set = this.#listeners.get(record.type);
      if (!set) continue;
      for (const listener of [...set]) listener(record.payload, tick);
    }
  }

  /** Drops queued events without delivering them. */
  clear(): void {
    this.#queue = [];
  }
}
