import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { fetchTopics, ServerTopic, setFollowedTopics } from '../services/topicsApi';

export interface Topics {
  loading: boolean;
  topics: ServerTopic[];
  /** Follow/unfollow one topic. The PUT sends every currently-followed slug
   *  from the full server list, so no topic is ever dropped by omission. */
  toggle: (slug: string) => void;
}

export function useTopics(): Topics {
  const { session } = useAuth();
  const [topics, setTopics] = useState<ServerTopic[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session) {
      setTopics([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchTopics()
      .then((list) => {
        if (!cancelled) setTopics(list);
      })
      .catch(() => {
        // Offline: leave the list empty; the screen shows its own notice
        // rather than a stale or invented set.
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const toggle = useCallback((slug: string) => {
    let nextFollowed: string[] = [];
    setTopics((prev) => {
      const next = prev.map((t) =>
        t.slug === slug ? { ...t, following: !t.following } : t
      );
      nextFollowed = next.filter((t) => t.following).map((t) => t.slug);
      return next;
    });
    // Fire-and-forget; on failure reload the server's truth so the pill can
    // never lie about what was actually saved.
    setFollowedTopics(nextFollowed).catch(() => {
      fetchTopics()
        .then(setTopics)
        .catch(() => {});
    });
  }, []);

  return { loading, topics, toggle };
}
