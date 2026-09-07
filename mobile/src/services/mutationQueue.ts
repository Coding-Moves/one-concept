import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Durable outbox for mutations made while offline (issue #133).
 *
 * Entries are COALESCED by a stable key, keeping only the latest intent — the
 * server operations are all idempotent or whole-list (like/save via PUT/DELETE,
 * topics via a whole-list PUT, daily-complete is idempotent), so replaying the
 * final desired state is correct and order across different keys doesn't matter.
 * A like→unlike→like offline collapses to a single "like"; two topic edits keep
 * only the final set.
 */
const QUEUE_KEY = 'one-concept/mutation-queue/v1';

export type QueuedMutation =
  | { kind: 'like'; slug: string; desired: boolean }
  | { kind: 'save'; slug: string; desired: boolean }
  | { kind: 'topics'; slugs: string[] }
  | { kind: 'learn' };

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

// In-memory mirror of the persisted map, lazily loaded once.
let map: Record<string, QueuedMutation> | null = null;

async function ensureLoaded(): Promise<Record<string, QueuedMutation>> {
  if (map) return map;
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    map = raw ? (JSON.parse(raw) as Record<string, QueuedMutation>) : {};
  } catch {
    map = {};
  }
  return map;
}

async function persist(): Promise<void> {
  if (map) await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(map)).catch(() => {});
}

/** Add or replace the intent for its key (latest wins). */
export async function enqueue(m: QueuedMutation): Promise<void> {
  const q = await ensureLoaded();
  q[keyOf(m)] = m;
  await persist();
}

/** Remove the intent at a key (no-op if absent). */
export async function dequeue(key: string): Promise<void> {
  const q = await ensureLoaded();
  if (key in q) {
    delete q[key];
    await persist();
  }
}

/** All pending intents (order across keys is not significant). */
export async function pending(): Promise<QueuedMutation[]> {
  return Object.values(await ensureLoaded());
}

/** Drop everything — used on sign-out so one account's queue can't leak. */
export async function clearQueue(): Promise<void> {
  map = {};
  await AsyncStorage.removeItem(QUEUE_KEY).catch(() => {});
}
