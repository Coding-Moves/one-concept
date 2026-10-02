import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiRequest, getConnectivity } from '../api/client';
import { Concept, DailyPayload } from '../types';
import { OfflineCache } from './offlineCache';
import { mapConcept, normalizeCachedConcept } from './conceptMapping';

export const conceptCache = new OfflineCache<Concept>(AsyncStorage, 'one-concept/concepts/v1/');

/** Server shape from GET /v1/concepts/{slug} (matches the daily ConceptOut). */
type ConceptResponse = DailyPayload['concept'];

/**
 * Fetch a full concept by slug for the detail view. The app uses the slug as a
 * concept's local id (see dailyApi.toConcept), so History/Saved conceptIds pass
 * straight through here.
 */
async function downloadConcept(slug: string): Promise<Concept> {
  const c = await apiRequest<ConceptResponse>(`/v1/concepts/${encodeURIComponent(slug)}`);
  return mapConcept(c);
}

/** These responses are authoritative: a downloaded copy must not hide them. */
export function isConceptUnavailable(error: unknown): boolean {
  return error instanceof ApiError && [403, 404, 410].includes(error.status);
}

/** Paint cached text immediately, then refresh counts/content when reachable. */
export async function fetchConcept(
  slug: string,
  onCached?: (concept: Concept) => void,
  forceRefresh = false,
): Promise<Concept> {
  const epoch = conceptCache.epoch;
  const stored = await conceptCache.get(slug, epoch);
  if (epoch !== conceptCache.epoch) throw new ApiError(401, 'Account changed');
  const cached = stored ? normalizeCachedConcept(stored) : null;
  if (cached) {
    onCached?.(cached);
    if (!getConnectivity() && !forceRefresh) return cached;
  }
  try {
    const concept = await downloadConcept(slug);
    await conceptCache.set(slug, concept, epoch).catch(() => {});
    if (epoch !== conceptCache.epoch) throw new ApiError(401, 'Account changed');
    return concept;
  } catch (error) {
    if (epoch !== conceptCache.epoch) throw new ApiError(401, 'Account changed');
    if (isConceptUnavailable(error)) {
      await conceptCache.remove(slug, epoch).catch(() => {});
      if (epoch !== conceptCache.epoch) throw new ApiError(401, 'Account changed');
      throw error;
    }
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
