import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DailyOutcome, fetchDaily, readDailyCache } from '../services/dailyApi';

export interface ServerDaily {
  loading: boolean;
  outcome: DailyOutcome | null;
  refresh: () => void;
}

/** Today's concept as decided by the backend, for signed-in users. */
export function useServerDaily(): ServerDaily {
  const { session } = useAuth();
  // Key the effect on the user id, not the session object: supabase hands back
  // a brand-new session object on every TOKEN_REFRESHED (roughly hourly, and on
  // every foreground), which would otherwise refetch /v1/daily each time even
  // though the signed-in user has not changed.
  const userId = session?.user?.id ?? null;
  const [outcome, setOutcome] = useState<DailyOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!userId) {
      setOutcome(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    // Cached concept first: the screen renders immediately, and the network
    // result replaces it whenever it arrives.
    //
    // The preview is NOT flagged stale, even though it comes from the cache: the
    // fetch below is still in flight, so we are not offline — we're loading.
    // `stale` only means "offline" once the fetch has actually failed and fallen
    // back to cache (fetchDaily sets it then). Painting the preview as stale is
    // what flashed the "Offline — showing your saved copy" banner during a
    // normal online load (issue #92).
    let settled = false;
    readDailyCache().then((cached) => {
      if (cancelled || settled || !cached) return;
      setOutcome(cached.status === 'ok' ? { ...cached, stale: false } : cached);
      setLoading(false);
    });

    fetchDaily().then((result) => {
      if (cancelled) return;
      settled = true;
      setOutcome(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { loading, outcome, refresh };
}
