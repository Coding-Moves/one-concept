import { Category, CATEGORIES } from '../types';

/**
 * Topic slugs are the server's stable identifiers; the Category strings are
 * what the UI renders. The seed migration created these exact pairs.
 */
export const SLUG_BY_CATEGORY: Record<Category, string> = {
  'Artificial Intelligence': 'artificial-intelligence',
  'Software Engineering': 'software-engineering',
  'Computer Science': 'computer-science',
  Mathematics: 'mathematics',
  'Linux & Systems': 'linux-systems',
};

const CATEGORY_BY_SLUG: Record<string, Category> = Object.fromEntries(
  CATEGORIES.map((c) => [SLUG_BY_CATEGORY[c], c])
) as Record<string, Category>;

export function toCategory(slug: string): Category | null {
  return CATEGORY_BY_SLUG[slug] ?? null;
}

export function toSlug(category: Category): string {
  return SLUG_BY_CATEGORY[category];
}
