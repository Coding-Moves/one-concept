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
  learned: { concept_slug: string; learned_on: string }[];
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
  ): Promise<ProgressState> {
    await apiRequest(`/v1/concepts/${encodeURIComponent(slug)}/${kind}`, {
      method: currently ? 'DELETE' : 'PUT',
    });
    return this.load();
  }

  async toggleLike(conceptId: string): Promise<ProgressState> {
    return this.toggle(conceptId, 'like', this.cache.likes.includes(conceptId));
  }

  async toggleBookmark(conceptId: string): Promise<ProgressState> {
    return this.toggle(conceptId, 'save', this.cache.bookmarks.includes(conceptId));
  }
}

export const remoteProgressRepository = new RemoteProgressRepository();

export async function clearServerStateCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
