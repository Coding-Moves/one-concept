import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { CONCEPTS } from '../data/concepts';
import { Category, Concept, ProgressState } from '../types';
import { selectDailyConcept } from '../services/dailyConcept';
import { todayKey } from '../services/dates';
import { EMPTY_PROGRESS, loadProgress, saveProgress } from '../services/storage';
import { computeStreaks, StreakStats } from '../services/streak';

export interface ProgressContextValue {
  loading: boolean;
  progress: ProgressState;
  /** Today's assigned concept. */
  concept: Concept | null;
  learnedToday: boolean;
  streaks: StreakStats;
  markLearned: () => void;
  toggleTopic: (category: Category) => void;
  toggleLike: (conceptId: string) => void;
  toggleBookmark: (conceptId: string) => void;
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

/** Concepts eligible for daily selection: followed topics, or all if none followed. */
function eligibleConcepts(progress: ProgressState): Concept[] {
  const pool = CONCEPTS.filter((c) => progress.followedTopics.includes(c.category));
  return pool.length > 0 ? pool : CONCEPTS;
}

function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * Single owner of the app's persisted learning state. All screens read from
 * this provider so Today, History, Stats, and Profile always agree.
 */
export function ProgressProvider({ children }: { children: ReactNode }) {
  const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);

  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await loadProgress();
      if (cancelled) return;

      const concept = selectDailyConcept(eligibleConcepts(stored), stored, today);
      const next: ProgressState =
        concept && stored.assignment?.date !== today
          ? { ...stored, assignment: { conceptId: concept.id, date: today } }
          : stored;

      setProgress(next);
      setLoading(false);
      if (next !== stored) {
        saveProgress(next).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [today]);

  const update = useCallback((updater: (prev: ProgressState) => ProgressState) => {
    setProgress((prev) => {
      const next = updater(prev);
      if (next !== prev) saveProgress(next).catch(() => {});
      return next;
    });
  }, []);

  // The day's assignment is pinned once made, even if the concept's topic is
  // unfollowed later that day — topic changes apply from the next assignment.
  const concept = selectDailyConcept(eligibleConcepts(progress), progress, today);
  const learnedToday = progress.learned.some((r) => r.date === today);

  const markLearned = useCallback(() => {
    if (!concept) return;
    update((prev) =>
      prev.learned.some((r) => r.date === today)
        ? prev
        : { ...prev, learned: [...prev.learned, { conceptId: concept.id, date: today }] }
    );
  }, [concept, today, update]);

  const toggleTopic = useCallback(
    (category: Category) => {
      update((prev) => ({
        ...prev,
        followedTopics: prev.followedTopics.includes(category)
          ? prev.followedTopics.filter((c) => c !== category)
          : [...prev.followedTopics, category],
      }));
    },
    [update]
  );

  const toggleLike = useCallback(
    (conceptId: string) => {
      update((prev) => ({ ...prev, likes: toggleInList(prev.likes, conceptId) }));
    },
    [update]
  );

  const toggleBookmark = useCallback(
    (conceptId: string) => {
      update((prev) => ({ ...prev, bookmarks: toggleInList(prev.bookmarks, conceptId) }));
    },
    [update]
  );

  const value: ProgressContextValue = {
    loading,
    progress,
    concept,
    learnedToday,
    streaks: computeStreaks(progress.learned),
    markLearned,
    toggleTopic,
    toggleLike,
    toggleBookmark,
  };

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const value = useContext(ProgressContext);
  if (!value) {
    throw new Error('useProgress must be used inside a ProgressProvider');
  }
  return value;
}
