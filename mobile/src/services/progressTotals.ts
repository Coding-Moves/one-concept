import type { LearnedRecord } from '../types';

/** Older aggregate counts plus the recent records (including offline completions). */
export function learnedTopicCounts(
  learned: LearnedRecord[],
  beforeWindow: Record<string, number> = {},
): Map<string, number> {
  const counts = new Map(Object.entries(beforeWindow));
  for (const record of learned) {
    if (record.topicName) {
      counts.set(record.topicName, (counts.get(record.topicName) ?? 0) + 1);
    }
  }
  return counts;
}
