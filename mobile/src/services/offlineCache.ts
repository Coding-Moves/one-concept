export interface CacheStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: string[]): Promise<void>;
}

/** Per-entry disk storage. Serial writes and a generation fence make sign-out
 * win over pending reads, writes, and downloads from the previous account. */
export class OfflineCache<T> {
  private storage: CacheStorage;
  private prefix: string;
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(storage: CacheStorage, prefix: string) {
    this.storage = storage;
    this.prefix = prefix;
  }

  get epoch(): number { return this.generation; }

  async get(id: string, epoch = this.epoch): Promise<T | null> {
    await this.writes;
    if (epoch !== this.epoch) return null;
    try {
      const raw = await this.storage.getItem(this.prefix + id);
      return raw && epoch === this.epoch ? JSON.parse(raw) as T : null;
    } catch {
      return null;
    }
  }

  set(id: string, value: T, epoch = this.epoch): Promise<void> {
    const raw = JSON.stringify(value);
    return this.write(async () => {
      if (epoch === this.epoch) await this.storage.setItem(this.prefix + id, raw);
    });
  }

  clear(): Promise<void> {
    this.generation += 1;
    return this.write(async () => {
      const keys = (await this.storage.getAllKeys()).filter(key => key.startsWith(this.prefix));
      if (keys.length) await this.storage.multiRemove(keys);
    });
  }

  private write(operation: () => Promise<void>): Promise<void> {
    const next = this.writes.then(operation);
    // A disk failure must not prevent later writes or account cleanup.
    this.writes = next.catch(() => {});
    return next;
  }
}
