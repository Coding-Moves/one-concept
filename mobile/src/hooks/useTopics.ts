import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchTopics, ServerTopic, topicStore } from '../services/topicsApi';

export interface Topics {
  loading: boolean;
  error: boolean;
  retry: () => void;
  topics: ServerTopic[];
  /** Follow/unfollow one topic. The PUT sends every currently-followed slug
   *  from the full server list, so no topic is ever dropped by omission. */
  toggle: (slug: string) => void;
}

export function useTopics(): Topics {
  const { session } = useAuth();
  // Key on the user id, not the session object: supabase hands a fresh object
  // on every token refresh, which would otherwise refetch the list hourly.
  const userId = session?.user?.id ?? null;
  const topics = useSyncExternalStore(topicStore.subscribe, topicStore.getSnapshot);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);
    fetchTopics()
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId, attempt]);

  const toggle = useCallback(
    (slug: string) => {
      topicStore.toggle(slug).catch(() => setError(true));
    },
    []
  );

  return { loading: loading && topics.length === 0, error, retry, topics, toggle };
}
