import AsyncStorage from '@react-native-async-storage/async-storage';
import { Category, Concept, DailyPayload } from '../types';

const CACHE_KEY = 'one-concept/daily-cache/v1';

/**
 * Map the server payload onto the app's Concept type.
 *
 * The concept's local id is its slug: the seed migration was generated from
 * this app's catalog, so server slugs and local ids are the same strings. That
 * keeps learned history, likes, and bookmarks consistent across the switch to
 * server-supplied concepts.
 */
export function toConcept(payload: DailyPayload): Concept {
  return {
    id: payload.concept.slug,
    title: payload.concept.title,
    category: payload.concept.topic_name as Category,
    summary: payload.concept.summary,
    example: payload.concept.example ?? undefined,
    likeCount: payload.concept.like_count ?? 0,
  };
}

/** Clear the legacy standalone daily cache. Today's concept now rides on the
 *  server-state cache (folded into /v1/me/state, #102); this only removes any
 *  leftover from older app versions. Still called on sign-out. */
export async function clearDailyCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
