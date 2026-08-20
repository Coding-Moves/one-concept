import { Concept, ProgressState } from '../types';

/** Deterministic 32-bit hash (FNV-1a) so the same date always maps to the same pick. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Choose today's concept:
 * - If a concept was already assigned for today, keep it (the day's concept
 *   must not change on re-open, even after marking it learned).
 * - Otherwise pick deterministically by date from concepts not yet learned.
 * - If every concept has been learned, cycle through the full list again.
 */
export function selectDailyConcept(
  concepts: Concept[],
  progress: ProgressState,
  dateKey: string
): Concept | null {
  if (concepts.length === 0) return null;

  if (progress.assignment?.date === dateKey) {
    const assigned = concepts.find((c) => c.id === progress.assignment!.conceptId);
    if (assigned) return assigned;
  }

  const learnedIds = new Set(progress.learned.map((r) => r.conceptId));
  const remaining = concepts.filter((c) => !learnedIds.has(c.id));
  const pool = remaining.length > 0 ? remaining : concepts;

  return pool[hashString(dateKey) % pool.length];
}
