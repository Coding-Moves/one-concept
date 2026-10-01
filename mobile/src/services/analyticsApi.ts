import { apiRequest } from '../api/client';
import type { Achievement } from './achievementStore';
import type { SubtopicProgress } from './subtopicProgressApi';

export interface AnalyticsRecentConcept {
  concept_slug: string;
  title: string;
  topic_name: string;
  completed_at: string;
}

export interface AnalyticsQuizAttempt {
  week_start: string;
  attempted_at: string;
  correct_count: number;
  question_count: number;
}

export interface AnalyticsActivityDay {
  day: string;
  concepts: number;
  reviews: number;
  quizzes: number;
}

export interface AnalyticsTopic {
  topic_slug: string;
  topic_name: string;
  completed_concepts: number;
}

export interface LearningAnalytics {
  total_concepts: number;
  total_reviews: number;
  weekly_quiz_attempts: number;
  correct_answers: number;
  answered_questions: number;
  current_streak: number;
  longest_streak: number;
  active_days: number;
  recent_concepts: AnalyticsRecentConcept[];
  recent_quizzes: AnalyticsQuizAttempt[];
  activity: AnalyticsActivityDay[];
  topics: AnalyticsTopic[];
  subtopics: SubtopicProgress[];
  achievements: Achievement[];
}

/** The API owns every total so analytics cannot drift from accepted progress. */
export function getLearningAnalytics(expectedUserId: string): Promise<LearningAnalytics> {
  return apiRequest<LearningAnalytics>('/v1/me/analytics', { expectedUserId });
}

export function quizAccuracy(correct: number, answered: number): number | null {
  return answered > 0 ? Math.round((correct / answered) * 100) : null;
}
