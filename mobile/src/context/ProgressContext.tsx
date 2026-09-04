import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  /** Whether a specific concept has ever been completed, by id — independent
   *  of which day it counts for, so it survives a cross-midnight completion. */
  hasLearned: (conceptId: string) => boolean;
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
  const repository: ProgressRepository =
    override ?? (session ? remoteProgressRepository : localProgressRepository);

  const today = todayKey();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      // The repository just swapped (sign-in or sign-out). The old account's
      // state must not stay on screen while the new source loads — wiping the
      // caches below is not enough when the leak lives in React state.
      setProgress(EMPTY_PROGRESS);

      // Paint from the last known state immediately — on a slow connection
      // the difference between this and waiting on the network is the whole
      // perceived speed of the app. The fresh load replaces it silently.
      const cached = await repository.loadCached?.();
      if (cached && !cancelled) {
        setProgress(cached);
        setLoading(false);
      }

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
  // Memoised so a parent re-render (e.g. an hourly token refresh handing down a
  // new session object) does not rebuild these and, through them, the context
  // value — which would re-render every screen for no user-visible change.
  const concept = useMemo(
    () => selectDailyConcept(eligibleConcepts(progress), progress, today),
    [progress, today]
  );
  const learnedToday = useMemo(
    () => progress.learned.some((r) => r.date === today),
    [progress.learned, today]
  );

  // A set for O(1) membership, rebuilt only when the learned list changes.
  const learnedIds = useMemo(
    () => new Set(progress.learned.map((r) => r.conceptId)),
    [progress.learned]
  );
  const hasLearned = useCallback((conceptId: string) => learnedIds.has(conceptId), [learnedIds]);

  // Optimistic writes: the screen changes the moment the user acts, the
  // repository confirms in the background, and a failure rolls the screen back
  // to what the server last agreed to — never a change that silently did not
  // persist.
  //
  // Mutations are serialised on this promise chain. Two overlapping writes used
  // to clobber each other: each captured a whole-state snapshot, so rolling the
  // first back restored a state that predated the second (erasing it), and the
  // success path replaced the whole state last-write-wins regardless of order.
  // Running one at a time means each mutation captures `before` as the *settled*
  // result of the previous one, so both its optimistic update and its rollback
  // compose correctly, and the server snapshot it applies is the latest.
  const chain = useRef<Promise<void>>(Promise.resolve());
  const apply = useCallback(
    (
      optimistic: ((prev: ProgressState) => ProgressState) | null,
      run: () => Promise<ProgressState>
    ) => {
      chain.current = chain.current.then(async () => {
        let before: ProgressState | null = null;
        if (optimistic) {
          setProgress((prev) => {
            before = prev;
            return optimistic(prev);
          });
        }
        try {
          setProgress(await run());
        } catch {
          if (before) setProgress(before);
        }
      });
    },
    []
  );

  const markLearned = useCallback(() => {
    if (!concept) return;
    apply(
      (prev) => {
        if (prev.learned.some((r) => r.date === today)) return prev;
        const learned = [...prev.learned, { conceptId: concept.id, date: today }];
        // A same-day completion always extends the current run by one; the
        // server's timezone-correct numbers replace this a moment later.
        const current = (prev.stats?.current ?? 0) + 1;
        return {
          ...prev,
          learned,
          stats: {
            current,
            longest: Math.max(prev.stats?.longest ?? 0, current),
            totalLearned: (prev.stats?.totalLearned ?? prev.learned.length) + 1,
          },
        };
      },
      () => repository.markLearned(concept.id, today)
    );
  }, [apply, concept, repository, today]);

  const toggleTopic = useCallback(
    (category: Category) =>
      apply(
        (prev) => ({
          ...prev,
          followedTopics: prev.followedTopics.includes(category)
            ? prev.followedTopics.filter((c) => c !== category)
            : [...prev.followedTopics, category],
        }),
        () => repository.toggleTopic(category)
      ),
    [apply, repository]
  );

  const flip = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const toggleLike = useCallback(
    (conceptId: string) =>
      apply(
        (prev) => ({ ...prev, likes: flip(prev.likes, conceptId) }),
        () => repository.toggleLike(conceptId)
      ),
    [apply, repository]
  );

  const toggleBookmark = useCallback(
    (conceptId: string) =>
      apply(
        (prev) => ({ ...prev, bookmarks: flip(prev.bookmarks, conceptId) }),
        () => repository.toggleBookmark(conceptId)
      ),
    [apply, repository]
  );

  // Prefer the server's numbers: they use the user's stored timezone rather
  // than the device clock, so a wrong clock cannot invent a streak.
  const streaks = useMemo(
    () => progress.stats ?? computeStreaks(progress.learned),
    [progress.stats, progress.learned]
  );

  const value = useMemo<ProgressContextValue>(
    () => ({
      loading,
      progress,
      concept,
      learnedToday,
      hasLearned,
      streaks,
      markLearned,
      toggleTopic,
      toggleLike,
      toggleBookmark,
    }),
    [
      loading,
      progress,
      concept,
      learnedToday,
      hasLearned,
      streaks,
      markLearned,
      toggleTopic,
      toggleLike,
      toggleBookmark,
    ]
  );

  return <ProgressContext.Provider value={value}>{children}</ProgressContext.Provider>;
}

export function useProgress(): ProgressContextValue {
  const value = useContext(ProgressContext);
  if (!value) {
    throw new Error('useProgress must be used inside a ProgressProvider');
  }
  return value;
}
