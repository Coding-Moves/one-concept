import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiRequest, isApiConfigured } from '../api/client';
import { Category, Concept } from '../types';

const CACHE_KEY = 'one-concept/daily-cache/v1';

export interface DailyPayload {
  assigned_for: string;
  assigned_at: string;
  completed_at: string | null;
  learned: boolean;
  outside_followed_topics: boolean;
  concept: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    example: string | null;
    topic_slug: string;
    topic_name: string;
    like_count?: number;
  };
}

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

export type DailyOutcome =
  | { status: 'ok'; payload: DailyPayload; stale: boolean }
  | { status: 'exhausted' }
  | { status: 'unavailable' };

/** Yesterday's (or earlier today's) concept from disk — paints instantly
 *  while the network answer replaces it. */
export async function readDailyCache(): Promise<DailyOutcome | null> {
  const cached = await readCache();
  return cached ? { status: 'ok', payload: cached, stale: true } : null;
}

async function readCache(): Promise<DailyPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as DailyPayload) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch today's concept, falling back to the last one we saw.
 *
 * Reading the day's concept must work on a train with no signal, so a network
 * failure returns the cached payload marked stale rather than an error.
 */
export async function fetchDaily(): Promise<DailyOutcome> {
  if (!isApiConfigured()) {
    const cached = await readCache();
    return cached ? { status: 'ok', payload: cached, stale: true } : { status: 'unavailable' };
  }

  try {
    const payload = await apiRequest<DailyPayload>('/v1/daily');
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(payload)).catch(() => {});
    return { status: 'ok', payload, stale: false };
  } catch (error) {
    // 409 means the catalog is genuinely exhausted for this user — not a failure
    // to reach the server, and not something a cached concept should paper over.
    if (error instanceof ApiError && error.status === 409) {
      return { status: 'exhausted' };
    }
    const cached = await readCache();
    return cached ? { status: 'ok', payload: cached, stale: true } : { status: 'unavailable' };
  }
}

export async function clearDailyCache(): Promise<void> {
  await AsyncStorage.removeItem(CACHE_KEY).catch(() => {});
}
