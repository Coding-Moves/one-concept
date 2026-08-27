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

export const CATEGORIES: Category[] = [
  'Artificial Intelligence',
  'Software Engineering',
  'Computer Science',
  'Mathematics',
  'Linux & Systems',
];

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

export interface StreakStats {
  current: number;
  longest: number;
  totalLearned: number;
}

/** Everything the app persists locally. */
export interface ProgressState {
  learned: LearnedRecord[];
  assignment: DailyAssignment | null;
  /** Topics the user follows; daily concepts are drawn from these. */
  followedTopics: Category[];
  /** Concept ids the user liked. */
  likes: string[];
  /** Concept ids the user saved for later. */
  bookmarks: string[];
  /**
   * Streaks as computed by the server, when the state came from the server.
   * Absent for purely local state, where the client derives them instead.
   */
  stats?: StreakStats;
}
