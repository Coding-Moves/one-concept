import type { ReportingApi } from "./OwnerDashboard";
import type {
  Overview,
  Operations,
  OperationalEvent,
  ReviewerReport,
} from "./ownerTypes";

export const demoObserved = "2026-10-02T12:00:00Z";
const reviewerNames = ["Amina Shah", "Daniel Brooks", "Maya Chen"];
const events: OperationalEvent[] = Array.from({ length: 36 }, (_, i) => ({
  key: `demo-${i}`,
  observed_at: `2026-10-02T${String(11 - Math.floor(i / 6)).padStart(2, "0")}:${String(50 - (i % 6) * 8).padStart(2, "0")}:00Z`,
  source: i % 3 === 0 ? "pool_topup" : i % 3 === 1 ? "review" : "reminders",
  action: i % 7 === 0 ? "failed" : i % 3 === 1 ? "approved" : "completed",
  severity: i % 7 === 0 ? "error" : "info",
  correlation_id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
}));
export function demoOverview(
  start = "2026-09-03",
  end = "2026-10-02",
): Overview {
  const days = Math.min(
    90,
    Math.max(
      1,
      Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1,
    ),
  );
  const trend = Array.from({ length: days }, (_, i) => ({
    day: new Date(Date.parse(start) + i * 86400000).toISOString().slice(0, 10),
    lessons: 12 + ((i * 7) % 29),
    reviews: 4 + ((i * 3) % 13),
    active: Math.min(10 + ((i * 5) % 21), 16 + ((i * 7) % 29) + ((i * 3) % 13)),
  }));
  return {
    observed_at: demoObserved,
    start: start + "T00:00:00Z",
    end,
    stop: end + "T23:59:59Z",
    metrics: {
      registered: 1248,
      new_registrations: days * 3,
      active_day: trend.at(-1)!.active,
      active_week: trend.slice(-7).reduce((n, d) => n + d.active, 0),
      active_month: trend.slice(-30).reduce((n, d) => n + d.active, 0),
      lessons: trend.reduce((n, d) => n + d.lessons, 0),
      reviews: trend.reduce((n, d) => n + d.reviews, 0),
    },
    trend,
    team: { active: 3, invited: 1, revoked: 1 },
    queue: { pending: 18, assigned: 15, overdue: 3 },
  };
}
export const demoReviewers: ReviewerReport[] = reviewerNames.map((name, i) => ({
  id: `demo-reviewer-${i}`,
  name,
  signature_at: demoObserved,
  status: "active",
  approval_events: 28 - i * 5,
  approved_concepts: 24 - i * 5,
  published_concepts: 20 - i * 4,
  changes_requested: 6 + i,
  rejections: 2,
  pending: 7 - i * 2,
  overdue: i === 0 ? 3 : 0,
}));
export const demoOperations: Operations = {
  observed_at: demoObserved,
  environment: "Demo",
  api: "reachable",
  database: "reachable",
  telemetry_enabled: true,
  generation_enabled: true,
  future_refill_enabled: false,
  legacy_enrichment_enabled: true,
  editorial_auto_correction_enabled: true,
  email_enabled: false,
  workers: [
    {
      service: "reminders",
      status: "completed",
      stale_after_minutes: 45,
      observation: {
        observed_at: demoObserved,
        code: "completed",
        correlation_id: events[0].correlation_id!,
      },
    },
    {
      service: "pool_topup",
      status: "stale",
      stale_after_minutes: 2160,
      observation: {
        observed_at: "2026-09-30T01:00:00Z",
        code: "completed",
        correlation_id: events[1].correlation_id!,
      },
    },
  ],
  budget: {
    reserved_calls: 48,
    configured_cap: 200,
    timezone: "America/Los_Angeles",
  },
  revision_jobs: { pending: 4, generating: 1, failed: 2, stale: 1 },
  emails: { pending: 6, sending: 0, failed: 1, sent_last_day: 12 },
  unavailable: [
    "Host CPU and memory",
    "Provider inbox delivery",
    "Historical uptime",
  ],
};

/** No network adapter, Auth client or mutation path exists in this demo. */
export const ownerDemoApi: ReportingApi = {
  async request<T>(path: string, method = "GET"): Promise<T> {
    if (method !== "GET") throw Error("Demo is read-only");
    const url = new URL(path, "https://demo.invalid"),
      p = url.searchParams;
    const start = p.get("start") || "2026-09-03",
      end = p.get("end") || "2026-10-02";
    let result: unknown;
    if (url.pathname === "/owner/overview") result = demoOverview(start, end);
    else if (url.pathname === "/owner/operations") result = demoOperations;
    else if (url.pathname === "/owner/reviewers")
      result = {
        items: demoReviewers,
        next_cursor: null,
        observed_at: demoObserved,
      };
    else if (url.pathname === "/owner/events") {
      const filtered = events.filter(
        (e) =>
          e.observed_at.slice(0, 10) >= start &&
          e.observed_at.slice(0, 10) <= end &&
          (!p.get("source") || e.source === p.get("source")) &&
          (!p.get("severity") || e.severity === p.get("severity")) &&
          (!p.get("correlation") ||
            e.correlation_id?.replaceAll("-", "").toLowerCase() ===
              p.get("correlation")!.replaceAll("-", "").toLowerCase()) &&
          (!p.get("search") ||
            (e.source + " " + e.action).includes(
              p.get("search")!.toLowerCase(),
            )),
      );
      const offset = Number(p.get("cursor") || 0),
        limit = 25;
      result = {
        items: filtered.slice(offset, offset + limit),
        next_cursor:
          filtered.length > offset + limit ? String(offset + limit) : null,
        observed_at: demoObserved,
      };
    } else throw Error("Unknown demo report");
    return structuredClone(result) as T;
  },
};
