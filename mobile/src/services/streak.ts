import { LearnedRecord, StreakStats } from '../types';
import { previousDateKey, todayKey } from './dates';

export type { StreakStats };

/**
 * Compute streak stats from learned history.
 * The current streak counts consecutive days ending today — or ending
 * yesterday, so an unfinished today doesn't break the streak prematurely.
 */
export function computeStreaks(learned: LearnedRecord[]): StreakStats {
  const days = new Set(learned.map((r) => r.date));

  let current = 0;
  let cursor = todayKey();
  if (!days.has(cursor)) cursor = previousDateKey(cursor);
  while (days.has(cursor)) {
    current++;
    cursor = previousDateKey(cursor);
  }

  let longest = 0;
  for (const day of days) {
    if (days.has(previousDateKey(day))) continue; // not the start of a run
    let length = 0;
    let next = day;
    while (days.has(next)) {
      length++;
      const [y, m, d] = next.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      date.setDate(date.getDate() + 1);
      next = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
        date.getDate()
      ).padStart(2, '0')}`;
    }
    longest = Math.max(longest, length);
  }

  return { current, longest, totalLearned: days.size };
}
