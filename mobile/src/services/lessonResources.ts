import type { Concept } from '../types';

type SearchableLesson = Pick<Concept, 'title' | 'category'>;
export type LessonResource = 'video' | 'reading';

/** Only public lesson metadata goes into an external search URL. */
export function lessonResourceUrl(lesson: SearchableLesson, resource: LessonResource): string | null {
  // Older cached records can violate today's TypeScript shape at runtime.
  if (typeof lesson.title !== 'string' || typeof lesson.category !== 'string') return null;
  const title = lesson.title.replace(/\s+/gu, ' ').trim();
  const topic = lesson.category.replace(/\s+/gu, ' ').trim();
  if (!title || !topic) return null;

  try {
    const query = encodeURIComponent(`${title} in ${topic}`);
    return resource === 'video'
      ? `https://www.youtube.com/results?search_query=${query}`
      : `https://www.google.com/search?q=${query}`;
  } catch {
    // Malformed Unicode from an old cached lesson must not crash a card tap.
    return null;
  }
}
