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
import { Category, Concept, DailyOutcome, ProgressState } from '../types';
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
  /** Today's assigned concept (local selection; the offline/demo fallback). */
  concept: Concept | null;
  /** Today's concept as decided by the server, folded into the state (#102). */
  serverDaily: DailyOutcome | null;
  learnedToday: boolean;
  /** Whether a specific concept has ever been completed, by id — independent
   *  of which day it counts for, so it survives a cross-midnight completion. */
  hasLearned: (conceptId: string) => boolean;
  streaks: StreakStats;
  /** Mark the day learned. Pass the concept actually shown (the server's, when
   *  signed in) so the recorded concept, title, and topic match it; falls back
   *  to the locally-selected concept when omitted. */
  markLearned: (target?: Concept) => void;
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

  // Optimistic writes: the screen changes the *instant* the user acts, the
  // repository confirms in the background, and a failure rolls back just that
  // change — never a write that silently did not persist.
  //
  // The optimistic update is applied immediately (not queued), so tapping Like
  // flips the icon at once even while a previous mutation is still in flight
  // (issue #95). The network runs are still serialised on a promise chain so
  // overlapping writes can't race server-side, and the whole-state server
  // snapshot is only applied when nothing else is pending — otherwise it would
  // momentarily wipe a later tap's optimistic change (a flicker). On failure we
  // undo just this change functionally, on top of the latest state, so a
  // concurrent change is never lost (the clobber #39 originally fixed).
  const chain = useRef<Promise<void>>(Promise.resolve());
  const pending = useRef(0);
  const apply = useCallback(
    (
      optimistic: ((prev: ProgressState) => ProgressState) | null,
      run: () => Promise<ProgressState>,
      undo?: (prev: ProgressState) => ProgressState
    ) => {
      if (optimistic) setProgress(optimistic);
      pending.current += 1;
      chain.current = chain.current.then(async () => {
        try {
          const next = await run();
          pending.current -= 1;
          if (pending.current === 0) setProgress(next);
        } catch {
          pending.current -= 1;
          if (undo) setProgress(undo);
        }
      });
    },
    []
  );

  const markLearned = useCallback((target?: Concept) => {
    // Prefer the concept the screen actually showed (the server's, when signed
    // in) so the learned record matches it; fall back to the local pick.
    const learnedConcept = target ?? concept;
    if (!learnedConcept) return;
    apply(
      (prev) => {
        if (prev.learned.some((r) => r.date === today)) return prev;
        const learned = [
          ...prev.learned,
          {
            conceptId: learnedConcept.id,
            date: today,
            // Carry the title/topic so the History row is right immediately and
            // survives a reload failure — otherwise the fallback would store a
            // titleless record for the wrong (locally-picked) concept.
            title: learnedConcept.title,
            topicName: learnedConcept.category,
          },
        ];
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
      () => repository.markLearned(learnedConcept.id, today),
      // On failure, remove just today's record; the stats revert is approximate
      // (longest can't be reconstructed) and the next state load corrects it.
      (prev) => ({
        ...prev,
        learned: prev.learned.filter((r) => r.date !== today),
        stats: prev.stats
          ? {
              current: Math.max(0, prev.stats.current - 1),
              longest: prev.stats.longest,
              totalLearned: Math.max(0, prev.stats.totalLearned - 1),
            }
          : prev.stats,
      })
    );
  }, [apply, concept, repository, today]);

  const toggleTopic = useCallback(
    (category: Category) => {
      const toggle = (prev: ProgressState) => ({
        ...prev,
        followedTopics: prev.followedTopics.includes(category)
          ? prev.followedTopics.filter((c) => c !== category)
          : [...prev.followedTopics, category],
      });
      apply(toggle, () => repository.toggleTopic(category), toggle);
    },
    [apply, repository]
  );

  const flip = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  const toggleLike = useCallback(
    (conceptId: string) => {
      // A flip is its own inverse, so the same updater serves as optimistic and undo.
      const toggle = (prev: ProgressState) => ({ ...prev, likes: flip(prev.likes, conceptId) });
      apply(toggle, () => repository.toggleLike(conceptId), toggle);
    },
    [apply, repository]
  );

  const toggleBookmark = useCallback(
    (conceptId: string) => {
      const toggle = (prev: ProgressState) => ({
        ...prev,
        bookmarks: flip(prev.bookmarks, conceptId),
      });
      apply(toggle, () => repository.toggleBookmark(conceptId), toggle);
    },
    [apply, repository]
  );

  // Prefer the server's numbers: they use the user's stored timezone rather
  // than the device clock, so a wrong clock cannot invent a streak.
  const streaks = useMemo(
    () => progress.stats ?? computeStreaks(progress.learned),
    [progress.stats, progress.learned]
  );

  const serverDaily = progress.serverDaily ?? null;

  const value = useMemo<ProgressContextValue>(
    () => ({
      loading,
      progress,
      concept,
      serverDaily,
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
      serverDaily,
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
