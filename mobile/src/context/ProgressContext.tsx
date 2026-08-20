import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { CONCEPTS } from '../data/concepts';
import { Concept, ProgressState } from '../types';
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
}

const ProgressContext = createContext<ProgressContextValue | null>(null);

/**
 * Single owner of the app's persisted learning state. All screens read from
 * this provider so Today, History, and Stats always agree.
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

      const concept = selectDailyConcept(CONCEPTS, stored, today);
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

  const concept = selectDailyConcept(CONCEPTS, progress, today);
  const learnedToday = progress.learned.some((r) => r.date === today);

  const markLearned = useCallback(() => {
    if (!concept) return;
    setProgress((prev) => {
      if (prev.learned.some((r) => r.date === today)) return prev;
      const next: ProgressState = {
        ...prev,
        learned: [...prev.learned, { conceptId: concept.id, date: today }],
      };
      saveProgress(next).catch(() => {});
      return next;
    });
  }, [concept, today]);

  const value: ProgressContextValue = {
    loading,
    progress,
    concept,
    learnedToday,
    streaks: computeStreaks(progress.learned),
    markLearned,
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
