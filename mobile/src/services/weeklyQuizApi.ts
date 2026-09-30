import { apiRequest } from '../api/client';

export interface WeeklyQuizQuestion {
  id: string;
  concept_slug: string;
  concept_title: string;
  content_version: number;
  question: string;
  options: string[];
}

export interface WeeklyQuiz {
  available: true;
  quiz_id: string;
  week_start: string;
  questions: WeeklyQuizQuestion[];
}

export interface WeeklyQuizUnavailable {
  available: false;
  week_start: string;
  required_concepts: number;
  available_concepts: number;
  detail: string;
}

export interface WeeklyQuizResult {
  question_id: string;
  selected_index: number;
  correct_index: number;
  correct: boolean;
}

export interface WeeklyQuizAttempt {
  attempt_id: string;
  quiz_id: string;
  week_start: string;
  attempted_at: string;
  correct_count: number;
  results: WeeklyQuizResult[];
}

export const fetchWeeklyQuiz = (userId: string) =>
  apiRequest<WeeklyQuiz | WeeklyQuizUnavailable>('/v1/quizzes/weekly', { expectedUserId: userId });

export const submitWeeklyQuiz = (userId: string, quizId: string, answers: { question_id: string; selected_index: number }[]) =>
  apiRequest<WeeklyQuizAttempt>(`/v1/quizzes/weekly/${quizId}/attempts`, {
    method: 'POST', expectedUserId: userId, body: { answers },
  });
