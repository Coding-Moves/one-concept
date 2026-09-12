import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiRequest } from '../api/client';
import { Category, DailyPayload, ProgressState } from '../types';
import { todayKey } from './dates';
import { cacheSavedConcepts, conceptCache } from './conceptApi';
import { toConcept } from './dailyApi';
import { clearQueue, dequeue, enqueue, keyOf, pending, QueuedMutation } from './mutationQueue';
import { ProgressRepository } from './progressRepository';
import { EMPTY_PROGRESS } from './storage';
import { toCategory, toSlug } from './topics';

const CACHE_KEY = 'one-concept/server-state/v1';

/** True for a network failure (no response) — the signal to queue offline. */
function isOffline(err: unknown): boolean {
  return err instanceof ApiError && err.status === 0;
}

interface StatePayload {
  display_name: string | null;
  timezone: string;
  today: string;
  followed_topics: string[];
  learned: {
    concept_slug: string;
    learned_on: string;
    title?: string;
    topic_name?: string;
    like_count?: number;
  }[];
  likes: string[];
  bookmarks: string[];
  saved?: { concept_slug: string; title?: string; topic_name?: string; like_count?: number }[];
  stats: { current: number; longest: number; total_learned: number };
  assignment_slug: string | null;
  daily?: DailyPayload | null;
}

function toProgressState(payload: StatePayload): ProgressState {
  return {
    learned: payload.learned.map((r) => ({
      conceptId: r.concept_slug,
      date: r.learned_on,
      title: r.title || undefined,
      topicName: r.topic_name || undefined,
      likeCount: r.like_count ?? 0,
    })),
    assignment: payload.assignment_slug
      ? { conceptId: payload.assignment_slug, date: payload.today }
      : null,
    followedTopics: payload.followed_topics
      .map(toCategory)
      .filter((c): c is Category => c !== null),
    likes: payload.likes,
    bookmarks: payload.bookmarks,
    savedConcepts: (payload.saved ?? []).map((s) => ({
      conceptId: s.concept_slug,
      title: s.title || '',
      topicName: s.topic_name || '',
      likeCount: s.like_count ?? 0,
    })),
    // Server-computed, so the day boundary comes from the user's stored
    // timezone rather than whatever the device clock happens to say.
    stats: {
      current: payload.stats.current,
      longest: payload.stats.longest,
      totalLearned: payload.stats.total_learned,
    },
    // Today's concept, folded in (#102). A fresh fetch is never "stale"; the
    // offline flag is set only when load() falls back to cache after a failure.
    serverDaily: payload.daily
      ? { status: 'ok', payload: payload.daily, stale: false }
      : { status: 'exhausted' },
  };
}

/**
 * Progress backed by the API.
 *
 * Every mutation returns the state the server now holds, so the UI can never
 * drift from it. The last good state is cached, and a failed load falls back to
 * that cache so the app still opens without a connection.
 */
export class RemoteProgressRepository implements ProgressRepository {
  private cache: ProgressState = EMPTY_PROGRESS;
  // Bumped by forget(). An operation captures the epoch when it starts; if a
  // wipe happened while its request was in flight, its late result must not
  // be re-persisted — that would resurrect the signed-out account's data.
  private epoch = 0;

  private async remember(state: ProgressState, epoch: number): Promise<ProgressState> {
    if (epoch !== this.epoch) return state;
    this.cache = state;
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(state)).catch(() => {});
    return state;
  }

  private async fromState(payload: StatePayload, epoch: number): Promise<ProgressState> {
    if (epoch !== this.epoch) return EMPTY_PROGRESS;
    // Keep each day's full text for later History/Saved reading, and download
    // saved bodies without holding up the initial screen.
    const contentEpoch = conceptCache.epoch;
    if (payload.daily) {
      const concept = toConcept(payload.daily);
      await conceptCache.set(concept.id, concept, contentEpoch).catch(() => {});
    }
    if (epoch !== this.epoch) return EMPTY_PROGRESS;
    void cacheSavedConcepts(payload.bookmarks, contentEpoch);
    return this.remember(toProgressState(payload), epoch);
  }

  /** Drop the in-memory state; the module singleton outlives a sign-out. The
   *  offline queue is account data too, so it goes with it. */
  forget(): void {
    this.epoch += 1;
    this.cache = EMPTY_PROGRESS;
    clearQueue().catch(() => {});
  }

  async loadCached(): Promise<ProgressState | null> {
    const epoch = this.epoch;
    const contentEpoch = conceptCache.epoch;
    const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    if (!raw || epoch !== this.epoch) return null;
    try {
      this.cache = JSON.parse(raw) as ProgressState;
      // Also upgrade an existing installation's cached Today while offline.
      if (this.cache.serverDaily?.status === 'ok') {
        const concept = toConcept(this.cache.serverDaily.payload);
        await conceptCache.set(concept.id, concept, contentEpoch).catch(() => {});
      }
      if (epoch !== this.epoch) return null;
      return this.cache;
    } catch {
      return null;
    }
  }

  async load(): Promise<ProgressState> {
    const epoch = this.epoch;
    try {
      return await this.fromState(await apiRequest<StatePayload>('/v1/me/state'), epoch);
    } catch {
      const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
      if (raw && epoch === this.epoch) {
        const cached = JSON.parse(raw) as ProgressState;
        // Genuinely offline: the fetch failed and we're serving the saved copy,
        // so flag the daily stale — that's what drives the "Offline" banner. The
        // cache-first preview (loadCached) leaves it not-stale, so the banner
        // still doesn't flash during a normal load (#92).
        const offline: ProgressState =
          cached.serverDaily?.status === 'ok'
            ? { ...cached, serverDaily: { ...cached.serverDaily, stale: true } }
            : cached;
        this.cache = offline;
        return offline;
      }
      return EMPTY_PROGRESS;
    }
  }

  /** The server assigns the day's concept; the client never proposes one. */
  async setAssignment(): Promise<ProgressState> {
    return this.cache;
  }

  async markLearned(
    conceptId: string,
    today: string,
    title?: string,
    topicName?: string
  ): Promise<ProgressState> {
    const epoch = this.epoch;
    let done: {
      completed: boolean;
      assigned_for: string;
      stats: { current: number; longest: number; total_learned: number };
    };
    try {
      done = await apiRequest('/v1/daily/complete', { method: 'POST' });
    } catch (err) {
      if (isOffline(err)) {
        // Queue the completion (with the date — it can only be replayed today)
        // and persist the optimistic record + streak bump so History AND the
        // streak stay right until the server's numbers replace them on sync.
        await enqueue({ kind: 'learn', date: today });
        const already = this.cache.learned.some((r) => r.date === today);
        const learned = already
          ? this.cache.learned
          : [...this.cache.learned, { conceptId, date: today, title, topicName }];
        const stats =
          already || !this.cache.stats
            ? this.cache.stats
            : {
                current: this.cache.stats.current + 1,
                longest: Math.max(this.cache.stats.longest, this.cache.stats.current + 1),
                totalLearned: this.cache.stats.totalLearned + 1,
              };
        return this.remember({ ...this.cache, learned, stats }, epoch);
      }
      throw err;
    }
    await dequeue('learn');

    // Reload the full state so History shows the true server record — the actual
    // completed concept with its title and topic — rather than a client-side
    // guess (the caller's concept id, no title). Without this the History tab
    // only caught up on a full reload, i.e. an app restart (issue #91).
    try {
      return await this.fromState(await apiRequest<StatePayload>('/v1/me/state'), epoch);
    } catch {
      // The completion already persisted; a failed reload must not roll it back.
      // Patch in place using the caller's concept id (the cached assignment can
      // be null when /v1/me/state resolved before /v1/daily created the row —
      // issue #38) and the streaks the complete call already returned.
      const learned = this.cache.learned.some((r) => r.date === done.assigned_for)
        ? this.cache.learned
        : [...this.cache.learned, { conceptId, date: done.assigned_for }];
      return this.remember({
        ...this.cache,
        learned,
        stats: {
          current: done.stats.current,
          longest: done.stats.longest,
          totalLearned: done.stats.total_learned,
        },
      }, epoch);
    }
  }

  async toggleTopic(category: Category): Promise<ProgressState> {
    const epoch = this.epoch;
    const following = this.cache.followedTopics.includes(category);
    const next = following
      ? this.cache.followedTopics.filter((c) => c !== category)
      : [...this.cache.followedTopics, category];
    const slugs = next.map(toSlug);

    // Whole-list semantics: PUT replaces the set, so a retry is harmless.
    try {
      const payload = await apiRequest<StatePayload>('/v1/me/topics', {
        method: 'PUT',
        body: { topics: slugs },
      });
      await dequeue('topics');
      return this.fromState(payload, epoch);
    } catch (err) {
      if (isOffline(err)) {
        await enqueue({ kind: 'topics', slugs });
        return this.remember({ ...this.cache, followedTopics: next }, epoch);
      }
      throw err;
    }
  }

  private async toggle(
    slug: string,
    kind: 'like' | 'save',
    currently: boolean
  ): Promise<void> {
    await apiRequest(`/v1/concepts/${encodeURIComponent(slug)}/${kind}`, {
      method: currently ? 'DELETE' : 'PUT',
    });
  }

  // A 2xx from a PUT/DELETE toggle confirms exactly the change we asked for,
  // so the cache can be patched in place — no full-state reload.
  async toggleLike(conceptId: string): Promise<ProgressState> {
    const epoch = this.epoch;
    const currently = this.cache.likes.includes(conceptId);
    const desired = !currently;
    const next: ProgressState = {
      ...this.cache,
      likes: desired
        ? [...this.cache.likes, conceptId]
        : this.cache.likes.filter((id) => id !== conceptId),
    };
    try {
      await this.toggle(conceptId, 'like', currently);
      await dequeue(`like:${conceptId}`);
      return this.remember(next, epoch);
    } catch (err) {
      if (isOffline(err)) {
        await enqueue({ kind: 'like', slug: conceptId, desired });
        return this.remember(next, epoch);
      }
      throw err;
    }
  }

  async toggleBookmark(
    conceptId: string,
    title?: string,
    topicName?: string
  ): Promise<ProgressState> {
    const epoch = this.epoch;
    const currently = this.cache.bookmarks.includes(conceptId);
    const desired = !currently;

    // Patch bookmarks/savedConcepts in place for the desired state — reused by
    // the offline and reload-failed paths. When saving offline, add a minimal
    // savedConcepts row (needs title + topic) so the concept shows in the Saved
    // list right away, not just in the count (#133). Leave savedConcepts alone
    // when it's absent (signed-out demo) or the caller didn't pass a title.
    const patched = (): ProgressState => {
      const bookmarks = desired
        ? [...this.cache.bookmarks, conceptId]
        : this.cache.bookmarks.filter((id) => id !== conceptId);
      let savedConcepts = this.cache.savedConcepts;
      if (savedConcepts) {
        if (desired) {
          if (title && topicName && !savedConcepts.some((s) => s.conceptId === conceptId)) {
            savedConcepts = [{ conceptId, title, topicName, likeCount: 0 }, ...savedConcepts];
          }
        } else {
          savedConcepts = savedConcepts.filter((s) => s.conceptId !== conceptId);
        }
      }
      return { ...this.cache, bookmarks, savedConcepts };
    };

    try {
      await this.toggle(conceptId, 'save', currently);
    } catch (err) {
      if (isOffline(err)) {
        await enqueue({ kind: 'save', slug: conceptId, desired });
        return this.remember(patched(), epoch);
      }
      throw err;
    }
    await dequeue(`save:${conceptId}`);
    // The save/unsave has already persisted. Refresh the full state so the saved
    // list (which needs each concept's title/topic) reflects it — but if that
    // refresh fails, do NOT throw: a succeeded toggle must never be rolled back
    // by the UI. Fall back to patching in place; the saved list catches up on
    // the next successful load.
    try {
      return await this.fromState(await apiRequest<StatePayload>('/v1/me/state'), epoch);
    } catch {
      return this.remember(patched(), epoch);
    }
  }

  /**
   * Replay queued offline mutations, then reconcile with the server (#133).
   * Called when connectivity returns. Stops (leaving the rest queued) on the
   * first network failure; drops an entry the server rejects with a 4xx (a
   * poison op that can never succeed), keeps 5xx to retry later. Returns the
   * reconciled state when the queue drains, or null if there's nothing to do
   * or we're still offline.
   */
  async flushQueue(): Promise<ProgressState | null> {
    const epoch = this.epoch;
    const entries = await pending();
    if (entries.length === 0) return null;

    const today = todayKey();
    for (const m of entries) {
      if (epoch !== this.epoch) return null; // signed out mid-flush

      // A completion can only be replayed on its own day — /v1/daily/complete
      // always targets "today", so a stale 'learn' is dropped, not replayed.
      if (m.kind === 'learn' && m.date !== today) {
        await dequeue(keyOf(m), m);
        continue;
      }

      try {
        await this.replay(m);
        await dequeue(keyOf(m), m); // guarded: don't clobber a newer same-key intent
      } catch (err) {
        if (isOffline(err)) return null; // still offline — keep the rest queued
        if (err instanceof ApiError && err.status >= 500) continue; // transient — retry next time
        await dequeue(keyOf(m), m); // 4xx: unfixable, drop so it can't block forever
      }
    }

    if (epoch !== this.epoch) return null;
    try {
      return await this.fromState(await apiRequest<StatePayload>('/v1/me/state'), epoch);
    } catch {
      return null;
    }
  }

  private async replay(m: QueuedMutation): Promise<void> {
    switch (m.kind) {
      case 'like':
        await apiRequest(`/v1/concepts/${encodeURIComponent(m.slug)}/like`, {
          method: m.desired ? 'PUT' : 'DELETE',
        });
        return;
      case 'save':
        await apiRequest(`/v1/concepts/${encodeURIComponent(m.slug)}/save`, {
          method: m.desired ? 'PUT' : 'DELETE',
        });
        return;
      case 'topics':
        await apiRequest('/v1/me/topics', { method: 'PUT', body: { topics: m.slugs } });
        return;
      case 'learn':
        await apiRequest('/v1/daily/complete', { method: 'POST' });
        return;
    }
  }
}

export const remoteProgressRepository = new RemoteProgressRepository();

/** Forget everything: the disk cache AND the singleton's in-memory copy.
 *  Called on sign-out so the next account can never see this one's data. */
export async function clearServerStateCache(): Promise<void> {
  remoteProgressRepository.forget();
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
