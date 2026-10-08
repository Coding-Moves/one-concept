import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError, apiRequest, getConnectivity } from '../api/client';
import { Concept, DailyPayload } from '../types';
import { OfflineCache } from './offlineCache';
import { mapConcept, normalizeCachedConcept } from './conceptMapping';
import { keepNewestConcept, refreshSavedConcepts } from './savedConceptSync';

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
    const latest = await keepNewestConcept(conceptCache, slug, concept, epoch);
    if (epoch !== conceptCache.epoch) throw new ApiError(401, 'Account changed');
    return normalizeCachedConcept(latest);
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

/** Revalidate only missing or older saved lessons when the server supplies
 * versions, and conservatively refresh on an older server. */
export async function cacheSavedConcepts(
  slugs: string[],
  epoch = conceptCache.epoch,
  versions: ReadonlyMap<string, number> | null = null,
): Promise<void> {
  await refreshSavedConcepts(slugs, conceptCache, downloadConcept, getConnectivity, epoch, versions);
}
