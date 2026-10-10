export interface Overview {
  observed_at: string;
  start: string;
  end: string;
  stop: string;
  metrics: {
    registered: number;
    new_registrations: number;
    active_day: number;
    active_week: number;
    active_month: number;
    lessons: number;
    reviews: number;
  };
  trend: { day: string; lessons: number; reviews: number; active: number }[];
  team: { invited: number; active: number; revoked: number };
  queue: { pending: number; assigned: number; overdue: number };
}
export interface ReviewerReport {
  id: string;
  name: string;
  signature_at: string | null;
  status: string;
  approval_events: number;
  approved_concepts: number;
  published_concepts: number;
  rejections: number;
  changes_requested: number;
  pending: number;
  overdue: number;
}
export interface Operations {
  observed_at: string;
  environment: string;
  api: string;
  database: string;
  telemetry_enabled: boolean;
  generation_enabled: boolean;
  future_refill_enabled?: boolean;
  legacy_enrichment_enabled?: boolean;
  editorial_auto_correction_enabled?: boolean;
  email_enabled: boolean;
  workers: {
    service: string;
    status: string;
    stale_after_minutes: number;
    observation: {
      observed_at: string;
      code: string;
      correlation_id: string;
    } | null;
  }[];
  budget: { reserved_calls: number; configured_cap: number; timezone: string };
  revision_jobs: {
    pending: number;
    generating: number;
    failed: number;
    stale: number;
  };
  emails: {
    pending: number;
    sending: number;
    failed: number;
    sent_last_day: number;
  };
  unavailable: string[];
}
export interface OperationalEvent {
  key: string;
  observed_at: string;
  source: string;
  action: string;
  severity: string;
  correlation_id: string | null;
}
export interface ReportPage<T> {
  items: T[];
  next_cursor: string | null;
  observed_at: string;
}
