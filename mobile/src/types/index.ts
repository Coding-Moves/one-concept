/** A single learnable concept. */
export interface Concept {
  id: string;
  title: string;
  category: Category;
  /** Short, technically meaningful explanation readable in under a minute. */
  summary: string;
  /** Optional concrete example that grounds the concept. */
  example?: string;
  /** Likes from other users; the viewer's own like is added on top for display. */
  likeCount?: number;
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
  /** Server-supplied name; present for signed-in users. */
  title?: string;
  /** Server-supplied topic name; present for signed-in users. */
  topicName?: string;
  /** Likes from other users on this concept. */
  likeCount?: number;
}

/** A concept the user bookmarked, with the details needed to render it. */
export interface SavedConcept {
  conceptId: string;
  title: string;
  /** Server-supplied topic name; the app's Category labels match these. */
  topicName: string;
  /** Likes from other users on this concept. */
  likeCount?: number;
}

/** Today's concept as the server sends it (folded into /v1/me/state, #102). */
export interface DailyPayload {
  assigned_for: string;
  assigned_at: string;
  completed_at: string | null;
  learned: boolean;
  outside_followed_topics: boolean;
  concept: {
    id: string;
    slug: string;
    title: string;
    summary: string;
    example: string | null;
    topic_slug: string;
    topic_name: string;
    like_count?: number;
  };
}

/** The server's daily result: today's concept, exhausted, or unavailable. */
export type DailyOutcome =
  | { status: 'ok'; payload: DailyPayload; stale: boolean }
  | { status: 'exhausted' }
  | { status: 'unavailable' };

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
   * Saved concepts with their titles/topics, for the Profile "Saved concepts"
   * list. Present only for server-backed state; absent for the signed-out demo,
   * which resolves saved items against the bundled catalog instead.
   */
  savedConcepts?: SavedConcept[];
  /**
   * Streaks as computed by the server, when the state came from the server.
   * Absent for purely local state, where the client derives them instead.
   */
  stats?: StreakStats;
  /**
   * Today's concept, folded into the server state so startup needs one request
   * (#102). Present only for server-backed state; the signed-out demo picks the
   * concept locally instead.
   */
  serverDaily?: DailyOutcome;
}
