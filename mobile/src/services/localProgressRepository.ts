import { Category, ProgressState } from '../types';
import { ProgressRepository } from './progressRepository';
import { EMPTY_PROGRESS, loadProgress, saveProgress } from './storage';

function toggleInList(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/**
 * On-device implementation backed by AsyncStorage.
 *
 * Keeps the last known state in memory so a mutation never has to re-read
 * storage, and persists after every change. Once the backend exists this
 * same class becomes the offline cache behind the HTTP repository.
 */
export class LocalProgressRepository implements ProgressRepository {
  private cache: ProgressState = EMPTY_PROGRESS;

  async load(): Promise<ProgressState> {
    this.cache = await loadProgress();
    return this.cache;
  }

  private async commit(next: ProgressState): Promise<ProgressState> {
    this.cache = next;
    await saveProgress(next);
    return next;
  }

  async setAssignment(conceptId: string, date: string): Promise<ProgressState> {
    if (this.cache.assignment?.date === date) return this.cache;
    return this.commit({ ...this.cache, assignment: { conceptId, date } });
  }

  async markLearned(conceptId: string, date: string): Promise<ProgressState> {
    // One completion per day, matching the server's UNIQUE (user_id, assigned_for).
    if (this.cache.learned.some((r) => r.date === date)) return this.cache;
    return this.commit({
      ...this.cache,
      learned: [...this.cache.learned, { conceptId, date }],
    });
  }

  async toggleTopic(category: Category): Promise<ProgressState> {
    const followed = this.cache.followedTopics;
    return this.commit({
      ...this.cache,
      followedTopics: followed.includes(category)
        ? followed.filter((c) => c !== category)
        : [...followed, category],
    });
  }

  async toggleLike(conceptId: string): Promise<ProgressState> {
    return this.commit({ ...this.cache, likes: toggleInList(this.cache.likes, conceptId) });
  }

  async toggleBookmark(conceptId: string): Promise<ProgressState> {
    return this.commit({
      ...this.cache,
      bookmarks: toggleInList(this.cache.bookmarks, conceptId),
    });
  }
}

/** The repository the app uses today. Swapped for the HTTP one in Phase 3. */
export const localProgressRepository = new LocalProgressRepository();
