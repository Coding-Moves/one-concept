import type { Concept } from '../types';
import type { OfflineCache } from './offlineCache';

/** A compact companion to bookmarks. A partial or malformed older response
 * cannot be used to declare an offline lesson current. */
export function bookmarkVersions(
  bookmarks: string[],
  versions?: number[],
): ReadonlyMap<string, number> | null {
  if (!Array.isArray(versions) || versions.length !== bookmarks.length
    || versions.some(version => !Number.isSafeInteger(version) || version < 1)) return null;
  return new Map(bookmarks.map((slug, index) => [slug, versions[index]]));
}

// State refreshes can overlap. Keep one download per saved slug in flight for
// each account epoch, then let a newer sync recheck the version it received.
const pendingByCache = new WeakMap<OfflineCache<Concept>, Map<string, Promise<void>>>();

function contentVersion(concept: Concept | null): number {
  const version = concept?.contentVersion;
  return typeof version === 'number' && Number.isSafeInteger(version) && version >= 1
    ? version : 0;
}

/** A detail response may have started before a saved-content refresh. Return
 * the newer body if that refresh finished while the detail request was in flight. */
export async function keepNewestConcept(
  cache: OfflineCache<Concept>,
  slug: string,
  concept: Concept,
  epoch = cache.epoch,
): Promise<Concept> {
  await cache.setIf(slug, concept, current =>
    contentVersion(current) <= contentVersion(concept), epoch).catch(() => {});
  const stored = await cache.get(slug, epoch);
  return stored && contentVersion(stored) > contentVersion(concept) ? stored : concept;
}

/** Revalidate missing or older saved bodies. Without bookmark_versions from an
 * older API, refresh every saved body so a correction cannot stay hidden. */
export async function refreshSavedConcepts(
  slugs: string[],
  cache: OfflineCache<Concept>,
  download: (slug: string) => Promise<Concept>,
  isOnline: () => boolean,
  epoch = cache.epoch,
  versions: ReadonlyMap<string, number> | null = null,
): Promise<void> {
  const remaining = [...new Set(slugs)];
  let cursor = 0;
  let pending = pendingByCache.get(cache);
  if (!pending) {
    pending = new Map();
    pendingByCache.set(cache, pending);
  }
  const queue = pending;
  const worker = async () => {
    while (cursor < remaining.length && epoch === cache.epoch && isOnline()) {
      const slug = remaining[cursor++];
      const key = `${epoch}:${slug}`;
      const previous = queue.get(key) ?? Promise.resolve();
      const current = previous.then(async () => {
        if (epoch !== cache.epoch || !isOnline()) return;
        const expected = versions?.get(slug);
        const cached = await cache.get(slug, epoch);
        if (epoch !== cache.epoch) return;
        if (expected && contentVersion(cached) >= expected) return;
        try {
          const concept = await download(slug);
          if (epoch !== cache.epoch) return;
          if (expected && contentVersion(concept) < expected) return;
          await cache.setIf(slug, concept, latest =>
            contentVersion(latest) <= contentVersion(concept), epoch);
        } catch {
          // Keep the downloaded copy and try again on the next state sync.
        }
      });
      queue.set(key, current);
      try { await current; } finally {
        if (queue.get(key) === current) queue.delete(key);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, worker));
}
