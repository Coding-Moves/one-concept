/**
 * Topics as the server defines them — the source of truth for the
 * Personalization screen. Fetching the live list (rather than a hardcoded
 * one) means a topic added server-side is visible, and following is done in
 * slug space so a topic the app has never heard of is never dropped.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../api/client';
import { enqueue, pending } from './mutationQueue';
import { OfflineCache } from './offlineCache';
import { TopicStore, ServerTopic } from './topicStore';

export type { ServerTopic } from './topicStore';
const cache = new OfflineCache<ServerTopic[]>(AsyncStorage, 'one-concept/topics/v1/');

interface TopicPayload {
  slug: string;
  name: string;
  concept_count: number;
  following: boolean;
}

export const topicStore = new TopicStore({
  read: () => cache.get('catalog'),
  write: topics => cache.set('catalog', topics),
  fetch: async () => {
    const rows = await apiRequest<TopicPayload[]>('/v1/topics');
    return rows.map(r => ({
      slug: r.slug, name: r.name, conceptCount: r.concept_count, following: r.following,
    }));
  },
  pending: async () => (await pending()).find(m => m.kind === 'topics')?.slugs,
  enqueue: slugs => enqueue({ kind: 'topics', slugs }),
});

export const fetchTopics = () => topicStore.load();

export async function clearTopicsCache(): Promise<void> {
  topicStore.reset();
  await cache.clear();
}
