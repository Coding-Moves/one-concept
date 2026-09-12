interface Storage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export type QueuedMutation =
  | { kind: 'like'; slug: string; desired: boolean }
  | { kind: 'save'; slug: string; desired: boolean }
  | { kind: 'topics'; slugs: string[] }
  // The date it was completed: /v1/daily/complete only completes "today", so a
  // 'learn' queued on a previous day must be dropped, not replayed (#133).
  | { kind: 'learn'; date: string };

/** Stable coalescing key — one pending intent per (kind, target). */
export function keyOf(m: QueuedMutation): string {
  switch (m.kind) {
    case 'like':
      return `like:${m.slug}`;
    case 'save':
      return `save:${m.slug}`;
    case 'topics':
      return 'topics';
    case 'learn':
      return 'learn';
  }
}

/** Serialize disk operations so replay acknowledgements cannot race a new
 * intent or resurrect data after sign-out. Keeps the existing disk format. */
export class MutationOutbox {
  private storage: Storage;
  private key: string;
  private epoch = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();

  constructor(storage: Storage, key: string) { this.storage = storage; this.key = key; }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private async read(): Promise<Record<string, QueuedMutation>> {
    const raw = await this.storage.getItem(this.key);
    try { return raw ? JSON.parse(raw) : {}; } catch { return {}; }
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.tail.then(operation);
    this.tail = next.catch(() => {});
    return next;
  }

  enqueue(mutation: QueuedMutation): Promise<void> {
    const epoch = this.epoch;
    return this.serial(async () => {
      const map = await this.read();
      if (epoch !== this.epoch) return;
      map[keyOf(mutation)] = mutation;
      await this.storage.setItem(this.key, JSON.stringify(map));
      if (epoch === this.epoch) this.listeners.forEach(listener => listener());
    });
  }

  dequeue(key: string, expected?: QueuedMutation): Promise<void> {
    const epoch = this.epoch;
    return this.serial(async () => {
      const map = await this.read();
      if (epoch !== this.epoch || !(key in map)) return;
      if (expected && JSON.stringify(map[key]) !== JSON.stringify(expected)) return;
      delete map[key];
      await this.storage.setItem(this.key, JSON.stringify(map));
    });
  }

  pending(): Promise<QueuedMutation[]> {
    const epoch = this.epoch;
    return this.serial(async () => {
      const map = await this.read();
      return epoch === this.epoch ? Object.values(map) : [];
    });
  }

  clear(): Promise<void> {
    this.epoch += 1;
    return this.serial(() => this.storage.removeItem(this.key));
  }
}
