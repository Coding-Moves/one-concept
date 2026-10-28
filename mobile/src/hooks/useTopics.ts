import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchTopics, ServerTopic, topicStore } from '../services/topicsApi';
import { pending as queuedMutations, subscribeQueue } from '../services/mutationQueue';

export interface Topics {
  loading: boolean;
  loadError: unknown;
  saveError: boolean;
  syncPending: boolean;
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
  const [loadError, setLoadError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const saveRevision = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    saveRevision.current += 1;
    setSaveError(false);
    return () => { saveRevision.current += 1; };
  }, [userId]);

  useEffect(() => {
    if (!userId) { setSyncPending(false); return; }
    let active = true;
    const update = () => {
      void queuedMutations().then(entries => {
        if (active) setSyncPending(entries.some(entry => entry.kind === 'topics'));
      }).catch(() => {});
    };
    update();
    const unsubscribe = subscribeQueue(update);
    return () => { active = false; unsubscribe(); };
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    fetchTopics()
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(cause);
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
      const revision = ++saveRevision.current;
      setSaveError(false);
      topicStore.toggle(slug).catch(() => {
        if (revision === saveRevision.current) setSaveError(true);
      });
    },
    []
  );

  return { loading: loading && topics.length === 0, loadError, saveError, syncPending, retry, topics, toggle };
}
