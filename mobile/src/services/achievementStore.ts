import type { OfflineCache } from './offlineCache';

export interface Achievement {
  code: string;
  metric: string;
  threshold: number;
  name: string;
  description: string;
  artwork_key: string;
  earned_on: string | null;
  source: string | null;
  seen_at: string | null;
}
export interface AchievementCollection {
  current_streak: number;
  longest_streak: number;
  items: Achievement[];
}
export interface AchievementSnapshot {
  collection: AchievementCollection;
  dismissed: string[];
}
type Transport = {
  load: (userId: string) => Promise<AchievementCollection>;
  acknowledge: (userId: string, codes: string[]) => Promise<void>;
};

/** One instance per mounted account. Disposing fences every asynchronous result;
 * OfflineCache's epoch also fences disk writes against sign-out cleanup. */
export class AchievementStore {
  private active = true;
  private epoch: number;
  private snapshot: AchievementSnapshot | null = null;
  private hydration: Promise<void> | null = null;
  private work: Promise<unknown> = Promise.resolve();
  private userId: string;
  private cache: OfflineCache<AchievementSnapshot>;
  private transport: Transport;
  constructor(userId: string, cache: OfflineCache<AchievementSnapshot>, transport: Transport) {
    this.userId = userId; this.cache = cache; this.transport = transport;
    this.epoch = cache.epoch;
  }

  dispose() { this.active = false; }
  private valid() { return this.active && this.epoch === this.cache.epoch; }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.work.then(operation);
    this.work = next.catch(() => {});
    return next;
  }
  private async save() {
    if (this.valid() && this.snapshot) {
      await this.cache.set(this.userId, this.snapshot, this.epoch).catch(() => {});
    }
  }
  async cached(): Promise<AchievementSnapshot | null> {
    // Refresh and the provider share one initial read. A fast response must
    // never overwrite a dismissal before its pending disk read finishes.
    this.hydration ??= (async () => {
      const value = await this.cache.get(this.userId, this.epoch);
      if (!this.valid()) return;
      // Ignore malformed/old cache shapes instead of crashing Profile.
      if (value && Array.isArray(value.collection?.items) && Array.isArray(value.dismissed)) {
        this.snapshot ??= value;
      }
    })();
    await this.hydration;
    return this.valid() ? this.snapshot : null;
  }
  refresh(): Promise<AchievementSnapshot | null> {
    return this.serial(async () => {
      if (!this.valid()) return null;
      await this.cached();
      if (!this.valid()) return null;
      const collection = await this.transport.load(this.userId);
      if (!this.valid()) return null;
      if (!Array.isArray(collection.items)) throw new Error('Invalid achievement response');
      this.snapshot = { collection, dismissed: this.snapshot?.dismissed ?? [] };
      await this.save();
      if (!this.valid()) return null;
      // Replay a dismissal after a failed/offline acknowledgement. Never grant
      // achievements optimistically; only the server's collection unlocks them.
      const pending = collection.items.filter(a => a.earned_on && !a.seen_at && this.snapshot!.dismissed.includes(a.code));
      if (pending.length) {
        await this.transport.acknowledge(this.userId, pending.map(a => a.code)).catch(() => {});
      }
      return this.valid() ? this.snapshot : null;
    });
  }
  dismiss(codes: string[]): Promise<AchievementSnapshot | null> {
    return this.serial(async () => {
      if (!this.valid() || !this.snapshot) return null;
      const earned = codes.filter(code => this.snapshot!.collection.items.some(a => a.code === code && a.earned_on));
      this.snapshot = { ...this.snapshot, dismissed: [...new Set([...this.snapshot.dismissed, ...earned])] };
      await this.save();
      if (!this.valid()) return null;
      // Don't hold the UI open waiting for an unreliable network. The next
      // refresh retries; requests are explicitly bound to this account.
      if (earned.length) void this.transport.acknowledge(this.userId, earned).catch(() => {});
      return this.snapshot;
    });
  }
}

export function uncelebrated(snapshot: AchievementSnapshot | null): Achievement[] {
  return snapshot?.collection.items.filter(a => a.earned_on && !a.seen_at && !snapshot.dismissed.includes(a.code)) ?? [];
}
export function nextMilestone(collection: AchievementCollection | null): Achievement | undefined {
  return collection?.items.find(a => a.metric === 'consecutive_days' && !a.earned_on);
}
