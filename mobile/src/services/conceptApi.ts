import { apiRequest } from '../api/client';
import { Category, Concept } from '../types';

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
export async function fetchConcept(slug: string): Promise<Concept> {
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
