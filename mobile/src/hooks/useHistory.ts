import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchHistoryPage, historyPageCache, HistoryPage } from '../services/historyApi';
import { ProgressState } from '../types';

/** Load one bounded page per action; a refresh/account change invalidates late responses. */
export function useHistory(progress: ProgressState) {
  const { session } = useAuth();
  const owner = session?.user.id ?? null;
  const key = JSON.stringify([owner, progress.learned, progress.historyNextCursor]);
  const [loaded, setLoaded] = useState<{key: string; pages: HistoryPage[]}>({key, pages: []});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(() => {
    generation.current++;
    busy.current = false;
    setLoading(false);
    setFailed(false);
    setLoaded({key, pages: []});
    return () => { generation.current++; };
  }, [key]);
  const pages = loaded.key === key ? loaded.pages : [];
  const records = useMemo(() => {
    const rows = new Map(pages.flatMap(page => page.items).map(row => [row.conceptId, row]));
    progress.learned.forEach(row => rows.set(row.conceptId, row));
    return [...rows.values()].sort((a,b) => b.date.localeCompare(a.date));
  }, [pages, progress.learned]);
  // Legacy cached states predate the cursor field but carry complete totals.
  const initialCursor = progress.historyNextCursor === undefined
    ? ((progress.stats?.totalLearned ?? 0) > progress.learned.length
      ? [...progress.learned].sort((a,b) => a.date.localeCompare(b.date))[0]?.date : null)
    : progress.historyNextCursor;
  const cursor = pages.length ? pages[pages.length - 1].nextCursor : initialCursor;
  const loadMore = useCallback(async () => {
    if (!owner || !cursor || busy.current) return;
    busy.current = true;
    const request = generation.current;
    const epoch = historyPageCache.epoch;
    setLoading(true);
    setFailed(false);
    try {
      const page = await fetchHistoryPage(owner, cursor, epoch);
      if (request !== generation.current || epoch !== historyPageCache.epoch) return;
      setLoaded(previous => ({key, pages: [...(previous.key === key ? previous.pages : []), page]}));
    } catch {
      if (request === generation.current) setFailed(true);
    } finally {
      if (request === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [owner, cursor, key]);
  return {records, loading, failed, hasMore: !!owner && !!cursor, loadMore};
}
