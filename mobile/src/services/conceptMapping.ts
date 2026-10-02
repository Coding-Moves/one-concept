import type { Concept, DailyPayload, ReviewAttribution } from '../types';

/** Metadata is useful only when it belongs to the displayed content version.
 * Also used at the rendering boundary, because disk caches predate this field.
 */
export function reviewForConcept(concept: Pick<Concept, 'contentVersion' | 'review'>): ReviewAttribution | undefined {
  const review = concept.review;
  if (!review || typeof review !== 'object'
    || !Number.isSafeInteger(concept.contentVersion) || concept.contentVersion! < 1
    || review.contentVersion !== concept.contentVersion
    || typeof review.name !== 'string' || review.name.trim().length < 2 || review.name.length > 160
    || /[\u0000-\u001f\u007f]/u.test(review.name)
    || typeof review.reviewedAt !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T/.test(review.reviewedAt)
    || !Number.isFinite(Date.parse(review.reviewedAt))) return undefined;
  return { name: review.name.trim(), reviewedAt: review.reviewedAt, contentVersion: review.contentVersion };
}

/** Daily/state and detail use one mapping and replace the entire body/evidence.
 * Do not merge reviewer metadata by slug or fill it from a previous response.
 */
export function mapConcept(c: DailyPayload['concept']): Concept {
  const candidate = c.review && typeof c.review === 'object' ? {
    name: c.review.name,
    reviewedAt: c.review.reviewed_at,
    contentVersion: c.review.content_version,
  } : undefined;
  return {
    id: c.slug,
    title: c.title,
    category: c.topic_name,
    summary: c.summary,
    example: c.example ?? undefined,
    flashcard: c.flashcard ?? undefined,
    likeCount: c.like_count ?? 0,
    contentVersion: c.content_version ?? 1,
    // Validate against the explicit server version, before the legacy default.
    review: reviewForConcept({ contentVersion: c.content_version, review: candidate }),
  };
}

export function normalizeCachedConcept(concept: Concept): Concept {
  return { ...concept, review: reviewForConcept(concept) };
}
