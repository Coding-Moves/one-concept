import { useCallback, useEffect, useMemo, useState } from 'react';
import { getConnectivity } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { conceptCache } from '../services/conceptApi';
import { fetchSavedPage, savedCollectionCache } from '../services/savedApi';
import { ProgressState, SavedConcept } from '../types';

/** Fetch older metadata only while Saved is open. Recent rows paint immediately;
 * cached pages and already-downloaded lesson bodies preserve offline search. */
export function useSavedConcepts(progress: ProgressState) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt(n => n + 1), []);
  const [loaded, setLoaded] = useState<{
    owner: string | null; items: SavedConcept[]; loading: boolean; failed: boolean;
  }>({ owner: null, items: [], loading: false, failed: false });
  // Equivalent state refreshes must not restart a failed page fetch in a loop.
  const key = JSON.stringify([progress.bookmarks, progress.savedConcepts, progress.savedNextCursor]);
  const snapshot = useMemo(() => ({
    bookmarks: progress.bookmarks, recent: progress.savedConcepts ?? [], cursor: progress.savedNextCursor,
  }), [key]);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const epoch = savedCollectionCache.epoch;
    const contentEpoch = conceptCache.epoch;
    const active = () => !cancelled && epoch === savedCollectionCache.epoch;
    const membership = new Set(snapshot.bookmarks);
    const rows = new Map<string, SavedConcept>();
    const recent = new Map(snapshot.recent.map(s => [s.conceptId, s]));
    const items = () => [...new Map([...recent, ...[...rows].map(([id, row]) =>
      [id, recent.get(id) ?? row] as const)]).values()].filter(s => membership.has(s.conceptId));
    const publish = (loading: boolean, failed = false) => {
      if (active()) setLoaded({ owner: userId, items: items(), loading, failed });
    };
    const persist = () => active()
      ? savedCollectionCache.set(userId, items(), epoch).catch(() => {}) : Promise.resolve();

    publish(true);
    void (async () => {
      const cached = await savedCollectionCache.get(userId, epoch);
      if (!active()) return;
      cached?.forEach(s => rows.set(s.conceptId, s));
      publish(!!snapshot.cursor);
      let failed = false;
      let cursor = snapshot.cursor;
      const seen = new Set<string>();
      try {
        // An explicit retry probes the network even if the last request was
        // offline; automatic loads can keep using downloaded metadata.
        while (cursor && active() && (getConnectivity() || attempt > 0)) {
          if (seen.has(cursor)) throw new Error('Repeated saved cursor');
          seen.add(cursor);
          const page = await fetchSavedPage(cursor);
          if (!active()) return;
          page.items.forEach(s => rows.set(s.conceptId, s));
          cursor = page.nextCursor;
          publish(!!cursor);
          await persist();
        }
      } catch {
        failed = true;
      }
      if (!active()) return;
      // Offline users may have downloaded all saved bodies without ever opening
      // this screen. Recover their metadata even if the list cache is absent.
      const missing = snapshot.bookmarks.filter(id => !rows.has(id) && !recent.has(id));
      for (let offset = 0; offset < missing.length && active(); offset += 20) {
        const concepts = await Promise.all(missing.slice(offset, offset + 20)
          .map(id => conceptCache.get(id, contentEpoch)));
        if (!active()) return;
        concepts.forEach(c => {
          if (c) rows.set(c.id, { conceptId: c.id, title: c.title, topicName: c.category, likeCount: c.likeCount });
        });
      }
      publish(false, failed || items().length < membership.size);
      await persist();
    })();
    return () => { cancelled = true; };
  }, [userId, snapshot, attempt]);

  const membership = new Set(progress.bookmarks);
  const rows = new Map((loaded.owner === userId ? loaded.items : []).map(s => [s.conceptId, s]));
  // Apply optimistic saves/unsaves immediately, before any in-flight page ends.
  progress.savedConcepts?.forEach(s => rows.set(s.conceptId, s));
  return {
    savedConcepts: progress.savedConcepts === undefined ? undefined
      : [...rows.values()].filter(s => membership.has(s.conceptId)),
    loading: !!userId && loaded.owner === userId && loaded.loading,
    failed: !!userId && loaded.owner === userId && loaded.failed,
    retry,
  };
}
