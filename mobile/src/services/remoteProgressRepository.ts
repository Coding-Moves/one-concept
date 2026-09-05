import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../api/client';
import { Category, ProgressState } from '../types';
import { ProgressRepository } from './progressRepository';
import { EMPTY_PROGRESS } from './storage';
import { toCategory, toSlug } from './topics';

const CACHE_KEY = 'one-concept/server-state/v1';

interface StatePayload {
  display_name: string | null;
  timezone: string;
  today: string;
  followed_topics: string[];
  learned: { concept_slug: string; learned_on: string; title?: string; topic_name?: string }[];
  likes: string[];
  bookmarks: string[];
  saved?: { concept_slug: string; title?: string; topic_name?: string }[];
  stats: { current: number; longest: number; total_learned: number };
  assignment_slug: string | null;
}

function toProgressState(payload: StatePayload): ProgressState {
  return {
    learned: payload.learned.map((r) => ({
      conceptId: r.concept_slug,
      date: r.learned_on,
      title: r.title || undefined,
      topicName: r.topic_name || undefined,
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
    })),
    // Server-computed, so the day boundary comes from the user's stored
    // timezone rather than whatever the device clock happens to say.
    stats: {
      current: payload.stats.current,
      longest: payload.stats.longest,
      totalLearned: payload.stats.total_learned,
    },
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
    return this.remember(toProgressState(payload), epoch);
  }

  /** Drop the in-memory state; the module singleton outlives a sign-out. */
  forget(): void {
    this.epoch += 1;
    this.cache = EMPTY_PROGRESS;
  }

  async loadCached(): Promise<ProgressState | null> {
    const epoch = this.epoch;
    const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
    if (!raw || epoch !== this.epoch) return null;
    try {
      this.cache = JSON.parse(raw) as ProgressState;
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
        this.cache = JSON.parse(raw) as ProgressState;
        return this.cache;
      }
      return EMPTY_PROGRESS;
    }
  }

  /** The server assigns the day's concept; the client never proposes one. */
  async setAssignment(): Promise<ProgressState> {
    return this.cache;
  }

  async markLearned(conceptId: string): Promise<ProgressState> {
    const epoch = this.epoch;
    const done = await apiRequest<{
      completed: boolean;
      assigned_for: string;
      stats: { current: number; longest: number; total_learned: number };
    }>('/v1/daily/complete', { method: 'POST' });

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

    // Whole-list semantics: PUT replaces the set, so a retry is harmless.
    const payload = await apiRequest<StatePayload>('/v1/me/topics', {
      method: 'PUT',
      body: { topics: next.map(toSlug) },
    });
    return this.fromState(payload, epoch);
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
    await this.toggle(conceptId, 'like', currently);
    return this.remember({
      ...this.cache,
      likes: currently
        ? this.cache.likes.filter((id) => id !== conceptId)
        : [...this.cache.likes, conceptId],
    }, epoch);
  }

  async toggleBookmark(conceptId: string): Promise<ProgressState> {
    const epoch = this.epoch;
    const currently = this.cache.bookmarks.includes(conceptId);
    await this.toggle(conceptId, 'save', currently);
    // The save/unsave has already persisted. Refresh the full state so the saved
    // list (which needs each concept's title/topic) reflects it — but if that
    // refresh fails, do NOT throw: a succeeded toggle must never be rolled back
    // by the UI. Fall back to patching in place; the saved list catches up on
    // the next successful load.
    try {
      return await this.fromState(await apiRequest<StatePayload>('/v1/me/state'), epoch);
    } catch {
      const bookmarks = currently
        ? this.cache.bookmarks.filter((id) => id !== conceptId)
        : [...this.cache.bookmarks, conceptId];
      const savedConcepts = currently
        ? (this.cache.savedConcepts ?? []).filter((s) => s.conceptId !== conceptId)
        : this.cache.savedConcepts;
      return this.remember({ ...this.cache, bookmarks, savedConcepts }, epoch);
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
