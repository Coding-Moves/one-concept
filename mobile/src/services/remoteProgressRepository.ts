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

  private async remember(state: ProgressState): Promise<ProgressState> {
    this.cache = state;
    AsyncStorage.setItem(CACHE_KEY, JSON.stringify(state)).catch(() => {});
    return state;
  }

  private async fromState(payload: StatePayload): Promise<ProgressState> {
    return this.remember(toProgressState(payload));
  }

  async load(): Promise<ProgressState> {
    try {
      return await this.fromState(await apiRequest<StatePayload>('/v1/me/state'));
    } catch {
      const raw = await AsyncStorage.getItem(CACHE_KEY).catch(() => null);
      if (raw) {
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

  async markLearned(): Promise<ProgressState> {
    // The response already carries the day and fresh streaks — merging it
    // saves a second round trip, which on a distant connection is the
    // difference between an instant tick and a multi-second stall.
    const done = await apiRequest<{
      completed: boolean;
      assigned_for: string;
      stats: { current: number; longest: number; total_learned: number };
    }>('/v1/daily/complete', { method: 'POST' });

    const conceptId = this.cache.assignment?.conceptId;
    const learned =
      conceptId && !this.cache.learned.some((r) => r.date === done.assigned_for)
        ? [...this.cache.learned, { conceptId, date: done.assigned_for }]
        : this.cache.learned;

    return this.remember({
      ...this.cache,
      learned,
      stats: {
        current: done.stats.current,
        longest: done.stats.longest,
        totalLearned: done.stats.total_learned,
      },
    });
  }

  async toggleTopic(category: Category): Promise<ProgressState> {
    const following = this.cache.followedTopics.includes(category);
    const next = following
      ? this.cache.followedTopics.filter((c) => c !== category)
      : [...this.cache.followedTopics, category];

    // Whole-list semantics: PUT replaces the set, so a retry is harmless.
    const payload = await apiRequest<StatePayload>('/v1/me/topics', {
      method: 'PUT',
      body: { topics: next.map(toSlug) },
    });
    return this.fromState(payload);
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
    const currently = this.cache.likes.includes(conceptId);
    await this.toggle(conceptId, 'like', currently);
    return this.remember({
      ...this.cache,
      likes: currently
        ? this.cache.likes.filter((id) => id !== conceptId)
        : [...this.cache.likes, conceptId],
    });
  }

  async toggleBookmark(conceptId: string): Promise<ProgressState> {
    const currently = this.cache.bookmarks.includes(conceptId);
    await this.toggle(conceptId, 'save', currently);
    return this.remember({
      ...this.cache,
      bookmarks: currently
        ? this.cache.bookmarks.filter((id) => id !== conceptId)
        : [...this.cache.bookmarks, conceptId],
    });
  }
}

export const remoteProgressRepository = new RemoteProgressRepository();

export async function clearServerStateCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
