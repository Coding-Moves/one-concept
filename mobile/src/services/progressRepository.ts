import { Category, ProgressState } from '../types';

/**
 * The seam between the app's state and wherever progress actually lives.
 *
 * Today the only implementation is local (AsyncStorage). When the backend
 * lands, an HTTP implementation drops in here and no screen changes.
 *
 * Every mutation returns the resulting state rather than mutating in place:
 * the local implementation computes it, and the server implementation will
 * return whatever the server considers authoritative.
 */
export interface ProgressRepository {
  load(): Promise<ProgressState>;

  /** Last known state without touching the network, or null if none exists.
   *  Lets the UI paint instantly while load() revalidates in the background. */
  loadCached?(): Promise<ProgressState | null>;

  /** Pin the concept assigned for a day. Server-side this becomes GET /v1/daily. */
  setAssignment(conceptId: string, date: string): Promise<ProgressState>;

  /** Mark the day's concept learned. Server-side: POST /v1/daily/complete. */
  markLearned(conceptId: string, date: string): Promise<ProgressState>;

  /** Follow / unfollow a topic. Server-side: PUT /v1/me/topics. */
  toggleTopic(category: Category): Promise<ProgressState>;

  /** Server-side: PUT|DELETE /v1/concepts/{id}/like. */
  toggleLike(conceptId: string): Promise<ProgressState>;

  /** Server-side: PUT|DELETE /v1/concepts/{id}/save. */
  toggleBookmark(conceptId: string): Promise<ProgressState>;
}
