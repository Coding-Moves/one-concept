import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../api/client';
import { LearnedRecord } from '../types';
import { OfflineCache } from './offlineCache';

export interface HistoryPage { items: LearnedRecord[]; nextCursor: string | null }
export const historyPageCache = new OfflineCache<HistoryPage>(AsyncStorage, 'one-concept/history-pages/v1/');

/** Pages stay separate from compact startup state and participate in sign-out. */
export async function fetchHistoryPage(userId: string, cursor: string, epoch: number): Promise<HistoryPage> {
  const key = `${userId}/${cursor}`;
  try {
    const page = await apiRequest<{
      items: { concept_slug: string; learned_on: string; title: string; topic_name: string; like_count: number }[];
      next_cursor: string | null;
    }>(`/v1/me/history?limit=50&before=${encodeURIComponent(cursor)}`);
    if (page.next_cursor && page.next_cursor >= cursor) throw new Error('History cursor did not advance');
    const result = {
      items: page.items.map(row => ({ conceptId: row.concept_slug, date: row.learned_on,
        title: row.title, topicName: row.topic_name, likeCount: row.like_count })),
      nextCursor: page.next_cursor,
    };
    await historyPageCache.set(key, result, epoch).catch(() => {});
    return result;
  } catch (error) {
    const cached = await historyPageCache.get(key, epoch);
    if (cached) return cached;
    throw error;
  }
}
