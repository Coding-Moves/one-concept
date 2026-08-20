/** A single learnable concept. */
export interface Concept {
  id: string;
  title: string;
  category: Category;
  /** Short, technically meaningful explanation readable in under a minute. */
  summary: string;
  /** Optional concrete example that grounds the concept. */
  example?: string;
}

export type Category =
  | 'Artificial Intelligence'
  | 'Software Engineering'
  | 'Computer Science'
  | 'Mathematics'
  | 'Linux & Systems';

/** A concept the user has completed, keyed by local calendar day. */
export interface LearnedRecord {
  conceptId: string;
  /** Local date in YYYY-MM-DD format. */
  date: string;
}

/** The concept assigned for a given day, fixed once chosen. */
export interface DailyAssignment {
  conceptId: string;
  /** Local date in YYYY-MM-DD format. */
  date: string;
}

/** Everything the app persists locally in Phase 1. */
export interface ProgressState {
  learned: LearnedRecord[];
  assignment: DailyAssignment | null;
}
