import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { DailyOutcome, fetchDaily } from '../services/dailyApi';

export interface ServerDaily {
  loading: boolean;
  outcome: DailyOutcome | null;
  refresh: () => void;
}

/** Today's concept as decided by the backend, for signed-in users. */
export function useServerDaily(): ServerDaily {
  const { session } = useAuth();
  const [outcome, setOutcome] = useState<DailyOutcome | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!session) {
      setOutcome(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchDaily().then((result) => {
      if (cancelled) return;
      setOutcome(result);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [session, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  return { loading, outcome, refresh };
}
