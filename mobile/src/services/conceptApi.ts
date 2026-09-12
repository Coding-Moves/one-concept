import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest, getConnectivity } from '../api/client';
import { Category, Concept } from '../types';
import { OfflineCache } from './offlineCache';

export const conceptCache = new OfflineCache<Concept>(AsyncStorage, 'one-concept/concepts/v1/');

/** Server shape from GET /v1/concepts/{slug} (matches the daily ConceptOut). */
interface ConceptResponse {
  id: string;
  slug: string;
  title: string;
  summary: string;
  example: string | null;
  topic_slug: string;
  topic_name: string;
  like_count?: number;
}

/**
 * Fetch a full concept by slug for the detail view. The app uses the slug as a
 * concept's local id (see dailyApi.toConcept), so History/Saved conceptIds pass
 * straight through here.
 */
async function downloadConcept(slug: string): Promise<Concept> {
  const c = await apiRequest<ConceptResponse>(`/v1/concepts/${encodeURIComponent(slug)}`);
  return {
    id: c.slug,
    title: c.title,
    category: c.topic_name as Category,
    summary: c.summary,
    example: c.example ?? undefined,
    likeCount: c.like_count ?? 0,
  };
}

/** Paint cached text immediately, then refresh counts/content when reachable. */
export async function fetchConcept(
  slug: string,
  onCached?: (concept: Concept) => void,
): Promise<Concept> {
  const epoch = conceptCache.epoch;
  const cached = await conceptCache.get(slug, epoch);
  if (cached) {
    onCached?.(cached);
    if (!getConnectivity()) return cached;
  }
  try {
    const concept = await downloadConcept(slug);
    await conceptCache.set(slug, concept, epoch).catch(() => {});
    return concept;
  } catch (error) {
    if (cached) return cached;
    throw error;
  }
}

/** Download every missing saved lesson with bounded concurrency. Individual
 * entries avoid one large AsyncStorage row; already-downloaded lessons stay. */
export async function cacheSavedConcepts(slugs: string[], epoch = conceptCache.epoch): Promise<void> {
  const remaining = [...new Set(slugs)];
  let cursor = 0;
  const worker = async () => {
    while (cursor < remaining.length && epoch === conceptCache.epoch && getConnectivity()) {
      const slug = remaining[cursor++];
      if (await conceptCache.get(slug, epoch)) continue;
      if (epoch !== conceptCache.epoch) return;
      try {
        await conceptCache.set(slug, await downloadConcept(slug), epoch);
      } catch {
        // Missing downloads retry on the next successful state load/reconnect.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, remaining.length) }, worker));
}
