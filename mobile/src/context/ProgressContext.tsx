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
import { remoteProgressRepository } from '../services/remoteProgressRepository';
import { useAuth } from './AuthContext';
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
  /** Overridable for tests; otherwise chosen by whether the user is signed in. */
  repository?: ProgressRepository;
}

/**
 * Single owner of the app's learning state. Screens read from this provider
 * so Today, History, Stats, and Profile always agree; persistence is entirely
 * the repository's business.
 */
export function ProgressProvider({ children, repository: override }: Props) {
  const { session } = useAuth();
  const [progress, setProgress] = useState<ProgressState>(EMPTY_PROGRESS);
  const [loading, setLoading] = useState(true);

  // Signed in, the server owns progress. Signed out, the device does — which
  // keeps the app usable before an account exists.
  const repository = override ?? (session ? remoteProgressRepository : localProgressRepository);

  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const stored = await repository.load();
      if (cancelled) return;

      // Pin today's concept on first open of the day so it can't change later.
      // The remote repository ignores this — the server already decided.
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
    // Prefer the server's numbers: they use the user's stored timezone rather
    // than the device clock, so a wrong clock cannot invent a streak.
    streaks: progress.stats ?? computeStreaks(progress.learned),
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
