import { apiRequest } from '../api/client';

export interface SubtopicQuizQuestion {
  id: string;
  concept_slug: string;
  concept_title: string;
  content_version: number;
  question: string;
  options: string[];
}

export interface SubtopicQuiz {
  available: true;
  quiz_id: string;
  completion_id: string;
  topic_name: string;
  subtopic_name: string;
  questions: SubtopicQuizQuestion[];
}

export interface SubtopicQuizUnavailable {
  available: false;
  completion_id: string;
  topic_name: string;
  subtopic_name: string;
  reviewed_concepts: number;
  required_concepts: number;
  detail: string;
}

export interface SubtopicQuizAttemptResult {
  question_id: string;
  selected_index: number;
  correct_index: number;
  correct: boolean;
}

export interface SubtopicQuizAttempt {
  attempt_id: string;
  quiz_id: string;
  completion_id: string;
  attempted_at: string;
  correct_count: number;
  question_count: number;
  results: SubtopicQuizAttemptResult[];
}

export interface SubtopicQuizAttemptSummary {
  attempt_id: string;
  attempted_at: string;
  correct_count: number;
  question_count: number;
}

export const fetchSubtopicQuiz = (userId: string, completionId: string) =>
  apiRequest<SubtopicQuiz | SubtopicQuizUnavailable>(`/v1/quizzes/subtopics/${completionId}`, {
    expectedUserId: userId,
  });

export const fetchSubtopicQuizHistory = (userId: string, completionId: string) =>
  apiRequest<{ items: SubtopicQuizAttemptSummary[] }>(
    `/v1/quizzes/subtopics/${completionId}/attempts`,
    { expectedUserId: userId },
  );

export const submitSubtopicQuiz = (
  userId: string,
  quizId: string,
  answers: { question_id: string; selected_index: number }[],
) => apiRequest<SubtopicQuizAttempt>(`/v1/quizzes/subtopics/${quizId}/attempts`, {
  method: 'POST', expectedUserId: userId, body: { answers },
});
