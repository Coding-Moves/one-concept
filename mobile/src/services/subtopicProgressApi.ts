import { apiRequest } from '../api/client';
import type { SubtopicCompletion } from '../types';

export interface SubtopicProgress {
  topic_slug: string;
  topic_name: string;
  subtopic_slug: string;
  subtopic_name: string;
  completed_concepts: number;
  available_concepts: number;
  completed: boolean;
}

export async function getSubtopicProgress(expectedUserId: string): Promise<SubtopicProgress[]> {
  const result = await apiRequest<{ items: SubtopicProgress[] }>('/v1/me/subtopics/progress', { expectedUserId });
  return Array.isArray(result.items) ? result.items : [];
}

/** Best effort only: dismissing a local confirmation must never block learning. */
export async function acknowledgeSubtopicCompletion(expectedUserId: string, completion: SubtopicCompletion): Promise<void> {
  await apiRequest<void>('/v1/me/subtopics/completions/seen', {
    method: 'POST', expectedUserId, body: { ids: [completion.id] },
  });
}
