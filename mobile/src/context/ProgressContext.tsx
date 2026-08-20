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
import { localProgressRepository } from '../services/localProgressRepository';
import { ProgressRepository } from '../services/progressRepository';
import { EMPTY_PROGRESS } from '../services/storage';
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

interface Props {
  children: ReactNode;
  /** Swappable for the HTTP-backed repository in Phase 3, and for tests. */
  repository?: ProgressRepository;
}

/**
 * Single owner of the app's learning state. Screens read from this provider
 * so Today, History, Stats, and Profile always agree; persistence is entirely
 * the repository's business.
 */
export function ProgressProvider({ children, repository = localProgressRepository }: Props) {
  const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);

  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const stored = await repository.load();
      if (cancelled) return;

      // Pin today's concept on first open of the day so it can't change later.
      const picked = selectDailyConcept(eligibleConcepts(stored), stored, today);
      const next = picked ? await repository.setAssignment(picked.id, today) : stored;
      if (cancelled) return;

      setProgress(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [repository, today]);

  // The day's assignment is pinned once made, even if the concept's topic is
  // unfollowed later that day — topic changes apply from the next assignment.
  const concept = selectDailyConcept(eligibleConcepts(progress), progress, today);
  const learnedToday = progress.learned.some((r) => r.date === today);

  // Writes are fire-and-forget against the repository; a failure leaves the
  // previous state on screen rather than showing a change that did not persist.
  const apply = useCallback((run: Promise<ProgressState>) => {
    run.then(setProgress).catch(() => {});
  }, []);

  const markLearned = useCallback(() => {
    if (!concept) return;
    apply(repository.markLearned(concept.id, today));
  }, [apply, concept, repository, today]);

  const toggleTopic = useCallback(
    (category: Category) => apply(repository.toggleTopic(category)),
    [apply, repository]
  );

  const toggleLike = useCallback(
    (conceptId: string) => apply(repository.toggleLike(conceptId)),
    [apply, repository]
  );

  const toggleBookmark = useCallback(
    (conceptId: string) => apply(repository.toggleBookmark(conceptId)),
    [apply, repository]
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
