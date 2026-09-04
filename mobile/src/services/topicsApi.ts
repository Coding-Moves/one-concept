/**
 * Topics as the server defines them — the source of truth for the
 * Personalization screen. Fetching the live list (rather than a hardcoded
 * one) means a topic added server-side is visible, and following is done in
 * slug space so a topic the app has never heard of is never dropped.
 */

import { apiRequest } from '../api/client';

export interface ServerTopic {
  slug: string;
  name: string;
  conceptCount: number;
  following: boolean;
}

interface TopicPayload {
  slug: string;
  name: string;
  concept_count: number;
  following: boolean;
}

export async function fetchTopics(): Promise<ServerTopic[]> {
  const rows = await apiRequest<TopicPayload[]>('/v1/topics');
  return rows.map((r) => ({
    slug: r.slug,
    name: r.name,
    conceptCount: r.concept_count,
    following: r.following,
  }));
}

/** Replace the followed set. Whole-list semantics: the caller sends every
 *  slug it wants followed, so nothing it omits by accident survives — which
 *  is exactly why the caller must pass the full server list, not a subset. */
export async function setFollowedTopics(slugs: string[]): Promise<void> {
  await apiRequest<void>('/v1/me/topics', { method: 'PUT', body: { topics: slugs } });
}
