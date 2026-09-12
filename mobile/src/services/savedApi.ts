import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../api/client';
import { SavedConcept } from '../types';
import { OfflineCache } from './offlineCache';

export const savedCollectionCache = new OfflineCache<SavedConcept[]>(AsyncStorage, 'one-concept/saved-list/v1/');

interface SavedPage {
  items: { concept_slug: string; title: string; topic_name: string; like_count: number }[];
  next_cursor: string | null;
}

export async function fetchSavedPage(cursor: string) {
  const page = await apiRequest<SavedPage>(`/v1/me/saved?limit=50&cursor=${encodeURIComponent(cursor)}`);
  return {
    items: page.items.map(s => ({
      conceptId: s.concept_slug, title: s.title, topicName: s.topic_name, likeCount: s.like_count,
    })),
    nextCursor: page.next_cursor,
  };
}
