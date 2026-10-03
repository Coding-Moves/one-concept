import { useEffect, useState } from "react";
import type { Api } from "./api";
import { ApiError } from "./api";
import { Badge, Field, Notice, message } from "./ui";
import type { Route } from "./App";
import type {
  Overview,
  Operations,
  OperationalEvent,
  ReviewerReport,
  ReportPage,
} from "./ownerTypes";

export type ReportingApi = Pick<Api, "request">;
const number = (n: number) => n.toLocaleString();
const words = (s: string) => s.replaceAll("_", " ");
const stamp = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    timeZone: "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " UTC";

function useReport<T>(api: ReportingApi, path: string, refresh: number) {
  const [state, set] = useState<{
    path: string;
    data?: T;
    error?: string;
    loading: boolean;
  }>({ path, loading: true });
  useEffect(() => {
    let active = true;
    set((old) => ({
      path,
      loading: true,
      data: old.path === path ? old.data : undefined,
    }));
    api
      .request<T>(path)
      .then((data) => {
        if (active) set({ path, data, loading: false });
      })
      .catch((error) => {
        if (!active || (error instanceof ApiError && error.status === 499))
          return;
        set((old) => ({
          path,
          loading: false,
          error: message(error),
          data:
            error instanceof ApiError && [401, 403].includes(error.status)
              ? undefined
              : old.data,
        }));
      });
    return () => {
      active = false;
    };
  }, [api, path, refresh]);
  return state.path === path ? state : { path, loading: true };
}
function Freshness({
  observed,
  error,
  demo,
}: {
  observed?: string;
  error?: string;
  demo: boolean;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const stale = !!observed && now - Date.parse(observed) > 120000;
  return (
    <div className="owner-freshness" aria-live="polite">
      {error && (
        <Notice error>
          {observed
            ? "Showing the last observation. Refresh failed. "
            : "Report unavailable. "}
          {error}
        </Notice>
      )}
      {observed && (
        <span>
          {demo
            ? "Synthetic snapshot"
            : error || stale
              ? "Snapshot · refresh for current data"
              : "Observed"}
          : {stamp(observed)}
        </span>
      )}
    </div>
  );
}
function Metric({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note: string;
}) {
  return (
    <article className="owner-metric">
      <p>{label}</p>
      <strong>{number(value)}</strong>
      <small>{note}</small>
    </article>
  );
}
function Table({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className="owner-table-scroll"
      role="region"
      aria-label={caption}
      tabIndex={0}
    >
      <table className="owner-table">
        <caption>{caption}</caption>
        {children}
      </table>
    </div>
  );
}
function OverviewPanel({
  api,
  query,
  refresh,
  demo,
  navigate,
}: {
  api: ReportingApi;
  query: string;
  refresh: number;
  demo: boolean;
  navigate?: (r: Route) => void;
}) {
  const { data, error, loading } = useReport<Overview>(
    api,
    "/owner/overview?" + query,
    refresh,
  );
  const max = Math.max(
    1,
    ...(data?.trend.map((d) => d.lessons + d.reviews) || []),
  );
  return (
    <>
      <Freshness observed={data?.observed_at} error={error} demo={demo} />
      {loading && <Notice>Loading learner activity…</Notice>}
      {data && (
        <>
          <div className="owner-metrics">
            <Metric
              label="Registered learners"
              value={data.metrics.registered}
              note="Remaining learner accounts at range end"
            />
            <Metric
              label="New learners"
              value={data.metrics.new_registrations}
              note="Registered during the selected range"
            />
            <Metric
              label="Lessons completed"
              value={data.metrics.lessons}
              note="First completion of each concept per learner"
            />
            <Metric
              label="Reviews completed"
              value={data.metrics.reviews}
              note="Completed daily review assignments"
            />
          </div>
          <section className="card owner-section">
            <div className="owner-section-title">
              <div>
                <p className="eyebrow">LEARNING ACTIVITY</p>
                <h2>Small steps, steady learning</h2>
                <p>Completed lessons and reviews by UTC day.</p>
              </div>
              <div className="owner-legend">
                <span>● Lessons</span>
                <span>● Reviews</span>
              </div>
            </div>
            {data.trend.every((d) => !d.lessons && !d.reviews) ? (
              <p className="owner-empty">
                No completed learning in this period.
              </p>
            ) : (
              <div className="owner-chart" aria-hidden="true">
                {data.trend.map((d) => (
                  <div
                    className="owner-bar-column"
                    key={d.day}
                    title={`${d.day}: ${d.lessons} lessons, ${d.reviews} reviews`}
                  >
                    <div
                      className="owner-bar"
                      style={{
                        height: `${((d.lessons + d.reviews) / max) * 100}%`,
                      }}
                    >
                      <span
                        className="owner-bar-review"
                        style={{ flex: d.reviews }}
                      />
                      <span style={{ flex: d.lessons }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="owner-chart-axis">
              <span>{data.start.slice(0, 10)}</span>
              <span>{data.end}</span>
            </div>
            <details>
              <summary>View activity as a table</summary>
              <Table caption="Daily learning activity">
                <thead>
                  <tr>
                    <th scope="col">UTC date</th>
                    <th scope="col">Lessons</th>
                    <th scope="col">Reviews</th>
                    <th scope="col">Active learners</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trend.map((d) => (
                    <tr key={d.day}>
                      <th scope="row">{d.day}</th>
                      <td>{d.lessons}</td>
                      <td>{d.reviews}</td>
                      <td>{d.active}</td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </details>
          </section>
          <div className="owner-two-columns">
            <section className="card owner-section">
              <p className="eyebrow">PARTICIPATION</p>
              <h2>Active learners</h2>
              <p>
                Unique learners who completed a lesson or review, ending on{" "}
                {data.end} (UTC).
              </p>
              <div className="owner-mini-metrics">
                {[
                  ["1 day", data.metrics.active_day],
                  ["7 days", data.metrics.active_week],
                  ["30 days", data.metrics.active_month],
                ].map(([label, value]) => (
                  <div key={label}>
                    <strong>{number(Number(value))}</strong>
                    <span>{label}</span>
                  </div>
                ))}
              </div>
            </section>
            <section className="card owner-section">
              <p className="eyebrow">REVIEW WORKLOAD · CURRENT</p>
              <h2>Ready for human attention</h2>
              <div className="owner-mini-metrics">
                <div>
                  <strong>{data.queue.pending}</strong>
                  <span>Open revisions</span>
                </div>
                <div>
                  <strong>{data.queue.assigned}</strong>
                  <span>Assigned</span>
                </div>
                <div>
                  <strong>{data.queue.overdue}</strong>
                  <span>Overdue</span>
                </div>
              </div>
              <p>
                {data.team.active} active members · {data.team.invited}{" "}
                onboarding · {data.team.revoked} revoked
              </p>
              {navigate && (
                <button onClick={() => navigate({ view: "queue" })}>
                  Open review queue →
                </button>
              )}
            </section>
          </div>
          <details className="card owner-section">
            <summary>How these numbers are counted</summary>
            <p>
              Registered learners are existing app profiles created by the range
              end. Editorial-only accounts with no completed learning are
              excluded. Deleted accounts and their learning records are
              excluded; test accounts in the connected database are included
              because there is no trusted test-account flag.
            </p>
            <p>
              Activity uses actual completion timestamps, not assignment dates
              or sign-ins. Daily, weekly and monthly figures use 1, 7 and 30 UTC
              calendar days through the selected end date. The current day is
              partial. Repeat requests cannot increase a learner’s unique
              concept completions. Review assignments count separately.
            </p>
            <p>
              Membership and workload are current snapshots; the date range
              controls learning and review-event totals. Reports refresh only
              when requested. Zero means a successful query found no matching
              records; an unavailable report never substitutes zero.
            </p>
          </details>
        </>
      )}
    </>
  );
}
function TeamPanel({
  api,
  query,
  refresh,
  demo,
  navigate,
}: {
  api: ReportingApi;
  query: string;
  refresh: number;
  demo: boolean;
  navigate?: (r: Route) => void;
}) {
  const [cursors, setCursors] = useState<string[]>([]),
    cursor = cursors.at(-1);
  const { data, error, loading } = useReport<ReportPage<ReviewerReport>>(
    api,
    "/owner/reviewers?" +
      query +
      (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
    refresh,
  );
  return (
    <>
      <Freshness observed={data?.observed_at} error={error} demo={demo} />
      <section className="card owner-section">
        <div className="owner-section-title">
          <div>
            <p className="eyebrow">TEAM CONTRIBUTIONS</p>
            <h2>Reviewers and their work</h2>
            <p>
              Activity for the selected period. Workload is current. This is a
              work report, not a ranking.
            </p>
          </div>
          {navigate && (
            <button onClick={() => navigate({ view: "team" })}>
              Manage reviewers →
            </button>
          )}
        </div>
        {loading && <Notice>Loading reviewer report…</Notice>}
        {data?.items.length === 0 && (
          <p className="owner-empty">No reviewer records for this period.</p>
        )}
        {!!data?.items.length && (
          <Table caption="Reviewer contributions">
            <thead>
              <tr>
                {[
                  "Reviewer",
                  "Status",
                  "Unique concepts approved",
                  "Approval events",
                  "Unique concepts published",
                  "Changes requested",
                  "Rejections",
                  "Open work",
                  "Overdue",
                ].map((x) => (
                  <th scope="col" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <span>{r.name}</span>
                    <small>
                      {r.signature_at
                        ? "Recorded review signature"
                        : "Current approved name / onboarding"}
                    </small>
                  </th>
                  <td>
                    <Badge status={r.status} />
                  </td>
                  <td>{r.approved_concepts}</td>
                  <td>{r.approval_events}</td>
                  <td>{r.published_concepts}</td>
                  <td>{r.changes_requested}</td>
                  <td>{r.rejections}</td>
                  <td>{r.pending}</td>
                  <td>{r.overdue}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="owner-pagination">
          <button
            disabled={!cursors.length || loading}
            onClick={() => setCursors((x) => x.slice(0, -1))}
          >
            Previous reviewers
          </button>
          <span>Page {cursors.length + 1}</span>
          <button
            disabled={!data?.next_cursor || loading}
            onClick={() => setCursors((x) => [...x, data!.next_cursor!])}
          >
            Next reviewers
          </button>
        </div>
        <details>
          <summary>Approval and identity definitions</summary>
          <p>
            Approval events include authenticated approvals and legacy
            attestations. Two reviewed versions of one concept count as two
            events but one unique approved concept per reviewer in this period.
            Publication counts use publication time and credit the approval
            author. The team-wide unique total cannot be found by adding every
            reviewer’s count.
          </p>
          <p>
            Names use the latest immutable review signature by the end of the
            period, falling back to the current approved name when none exists.
            Renaming or revoking a reviewer does not rewrite signatures. Deleted
            reviewers with historical events stay in the period report. Current
            open work excludes outdated revisions and archived concepts.
          </p>
        </details>
      </section>
    </>
  );
}
function OperationsPanel({
  api,
  refresh,
  demo,
}: {
  api: ReportingApi;
  refresh: number;
  demo: boolean;
}) {
  const { data, error, loading } = useReport<Operations>(
    api,
    "/owner/operations",
    refresh,
  );
  return (
    <>
      <Freshness observed={data?.observed_at} error={error} demo={demo} />
      {loading && <Notice>Loading operational snapshot…</Notice>}
      {data && (
        <>
          <div className="owner-two-columns">
            <section className="card owner-section">
              <p className="eyebrow">THIS REQUEST</p>
              <h2>Service connectivity</h2>
              <dl className="owner-status-list">
                <div>
                  <dt>Environment</dt>
                  <dd>{data.environment}</dd>
                </div>
                <div>
                  <dt>API</dt>
                  <dd>{words(data.api)}</dd>
                </div>
                <div>
                  <dt>Database</dt>
                  <dd>{words(data.database)}</dd>
                </div>
                <div>
                  <dt>Generation</dt>
                  <dd>{data.generation_enabled ? "Enabled" : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Reviewer email</dt>
                  <dd>{data.email_enabled ? "Enabled" : "Disabled"}</dd>
                </div>
                <div>
                  <dt>Structured telemetry</dt>
                  <dd>{data.telemetry_enabled ? "Enabled" : "Disabled"}</dd>
                </div>
              </dl>
              <p>
                This confirms reachability for this report, not historical
                uptime or successful email delivery.
              </p>
            </section>
            <section className="card owner-section">
              <p className="eyebrow">GENERATION BUDGET</p>
              <h2>
                {number(data.budget.reserved_calls)}{" "}
                <small>
                  / {number(data.budget.configured_cap)} calls reserved
                </small>
              </h2>
              <progress
                aria-label="Daily generation budget reserved"
                max={Math.max(1, data.budget.configured_cap)}
                value={data.budget.reserved_calls}
              />
              <p>
                Budget day: {data.budget.timezone}. Reservations can include
                failed attempts; this is not a billing total.
              </p>
              <div className="owner-mini-metrics">
                <div>
                  <strong>{data.revision_jobs.pending}</strong>
                  <span>AI jobs waiting</span>
                </div>
                <div>
                  <strong>{data.revision_jobs.failed}</strong>
                  <span>Failed AI jobs</span>
                </div>
                <div>
                  <strong>{data.revision_jobs.stale}</strong>
                  <span>Stale claims</span>
                </div>
              </div>
            </section>
          </div>
          <section className="card owner-section">
            <p className="eyebrow">BACKGROUND PROCESSES</p>
            <h2>Last worker observations</h2>
            <div className="owner-two-columns">
              {data.workers.map((w) => (
                <article className="owner-worker" key={w.service}>
                  <div className="owner-section-title">
                    <h3>{words(w.service)}</h3>
                    <Badge status={w.status} />
                  </div>
                  <p>
                    {w.observation
                      ? stamp(w.observation.observed_at)
                      : "No observation recorded"}
                  </p>
                  <small>
                    A completed process is not a promise that content was
                    generated or a message delivered. Completion is stale after{" "}
                    {w.stale_after_minutes} minutes; a start without completion
                    becomes stale after 30 minutes.
                  </small>
                </article>
              ))}
            </div>
          </section>
          <section className="card owner-section">
            <h2>Reviewer email delivery</h2>
            <div className="owner-mini-metrics">
              {[
                ["Pending", data.emails.pending],
                ["Sending", data.emails.sending],
                ["Failed", data.emails.failed],
                ["Accepted in 24h", data.emails.sent_last_day],
              ].map(([label, value]) => (
                <div key={label}>
                  <strong>{number(Number(value))}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p>
              “Accepted” means the provider accepted the message; inbox receipt
              is not measured here.
            </p>
          </section>
          <section className="card owner-section">
            <h2>Signals not available here</h2>
            <ul>
              {data.unavailable.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p>
              Use the hosting/provider console for those signals. This dashboard
              has no shell, raw logs or infrastructure credentials.
            </p>
          </section>
        </>
      )}
    </>
  );
}
function EventsPanel({
  api,
  query,
  refresh,
  demo,
}: {
  api: ReportingApi;
  query: string;
  refresh: number;
  demo: boolean;
}) {
  const [draft, setDraft] = useState({
      source: "",
      severity: "",
      search: "",
      correlation: "",
    }),
    [filters, setFilters] = useState(draft),
    [cursors, setCursors] = useState<string[]>([]);
  const p = new URLSearchParams(query);
  Object.entries(filters).forEach(([k, v]) => {
    if (v.trim()) p.set(k, v.trim());
  });
  if (cursors.at(-1)) p.set("cursor", cursors.at(-1)!);
  const { data, error, loading } = useReport<ReportPage<OperationalEvent>>(
    api,
    "/owner/events?" + p,
    refresh,
  );
  return (
    <>
      <section className="card owner-section">
        <p className="eyebrow">SAFE EVENT STREAM</p>
        <h2>Operational and audit events</h2>
        <p>
          Structured status codes only. Worker/API observations: up to 30 days;
          immutable audit events: selected range, up to 90 days.
        </p>
        <form
          className="owner-event-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setFilters({ ...draft });
            setCursors([]);
          }}
        >
          <Field title="Service or event source">
            <select
              value={draft.source}
              onChange={(e) => setDraft({ ...draft, source: e.target.value })}
            >
              <option value="">All sources</option>
              {[
                "api",
                "reminders",
                "pool_topup",
                "review",
                "workflow",
                "account",
              ].map((x) => (
                <option key={x} value={x}>
                  {words(x)}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Severity">
            <select
              value={draft.severity}
              onChange={(e) => setDraft({ ...draft, severity: e.target.value })}
            >
              <option value="">All severities</option>
              <option value="info">Info</option>
              <option value="error">Error</option>
            </select>
          </Field>
          <Field title="Search status code">
            <input
              maxLength={80}
              value={draft.search}
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
          </Field>
          <Field title="Correlation ID">
            <input
              maxLength={36}
              pattern="[0-9a-fA-F]{32}|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              placeholder="Incident ID or UUID"
              value={draft.correlation}
              onChange={(e) =>
                setDraft({ ...draft, correlation: e.target.value })
              }
            />
          </Field>
          <button type="submit">Apply event filters</button>
        </form>
        <Freshness observed={data?.observed_at} error={error} demo={demo} />
        {loading && <Notice>Loading events…</Notice>}
        {data?.items.length === 0 && (
          <p className="owner-empty">No events match these filters.</p>
        )}
        {!!data?.items.length && (
          <Table caption="Operational events">
            <thead>
              <tr>
                {[
                  "Observed (UTC)",
                  "Source",
                  "Status code",
                  "Severity",
                  "Correlation ID",
                ].map((x) => (
                  <th scope="col" key={x}>
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((e) => (
                <tr key={e.key}>
                  <td>{stamp(e.observed_at)}</td>
                  <td>{words(e.source)}</td>
                  <td>{words(e.action)}</td>
                  <td>
                    <Badge status={e.severity} />
                  </td>
                  <td>
                    <code>{e.correlation_id || "Not recorded"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <div className="owner-pagination">
          <button
            disabled={!cursors.length || loading}
            onClick={() => setCursors((x) => x.slice(0, -1))}
          >
            Previous events
          </button>
          <span>Page {cursors.length + 1}</span>
          <button
            disabled={!data?.next_cursor || loading}
            onClick={() => setCursors((x) => [...x, data!.next_cursor!])}
          >
            Next events
          </button>
        </div>
      </section>
    </>
  );
}
export function OwnerDashboard({
  api,
  environment,
  demo = false,
  navigate,
}: {
  api: ReportingApi;
  environment: string;
  demo?: boolean;
  navigate?: (r: Route) => void;
}) {
  const today = demo ? "2026-10-02" : new Date().toISOString().slice(0, 10);
  const initial = {
    start: new Date(Date.parse(today) - 29 * 86400000)
      .toISOString()
      .slice(0, 10),
    end: today,
  };
  const [draft, setDraft] = useState(initial),
    [range, setRange] = useState(initial),
    [tab, setTab] = useState("Overview"),
    [refresh, setRefresh] = useState(0),
    [rangeError, setRangeError] = useState("");
  const query = new URLSearchParams(range).toString();
  function apply(e: React.FormEvent) {
    e.preventDefault();
    const days = (Date.parse(draft.end) - Date.parse(draft.start)) / 86400000;
    if (!Number.isFinite(days) || days < 0 || days > 89 || draft.end > today) {
      setRangeError(
        "Choose an ordered range of at most 90 days, ending no later than today.",
      );
      return;
    }
    setRangeError("");
    setRange({ ...draft });
    setRefresh((x) => x + 1);
  }
  return (
    <div className="owner-dashboard">
      <div className="owner-section-title">
        <div>
          <p className="eyebrow">ONE CONCEPT / OWNER</p>
          <h1>Your learning community</h1>
          <p>
            Learner activity, review work and service observations in one place.
          </p>
        </div>
        <span className="environment">
          {demo ? "DEMO · SYNTHETIC DATA" : environment}
        </span>
      </div>
      {demo && (
        <Notice>
          Demo only. These people and numbers are synthetic. No production
          connection or actions are available.
        </Notice>
      )}
      <nav className="owner-tabs" aria-label="Owner reports">
        {["Overview", "Reviewers", "Operations", "Events"].map((x) => (
          <button
            key={x}
            aria-current={tab === x ? "page" : undefined}
            className={tab === x ? "primary" : ""}
            onClick={() => setTab(x)}
          >
            {x}
          </button>
        ))}
      </nav>
      <form className="owner-range" onSubmit={apply}>
        <Field title="From (UTC)">
          <input
            type="date"
            required
            max={today}
            value={draft.start}
            onChange={(e) => setDraft({ ...draft, start: e.target.value })}
          />
        </Field>
        <Field title="Through (UTC)">
          <input
            type="date"
            required
            max={today}
            value={draft.end}
            onChange={(e) => setDraft({ ...draft, end: e.target.value })}
          />
        </Field>
        <button type="submit">Apply dates</button>
        <button type="button" onClick={() => setRefresh((x) => x + 1)}>
          Refresh reports
        </button>
        <span>Read-only · UTC · no automatic polling</span>
      </form>
      {rangeError && <Notice error>{rangeError}</Notice>}
      <div key={query + tab}>
        {tab === "Overview" ? (
          <OverviewPanel
            api={api}
            query={query}
            refresh={refresh}
            demo={demo}
            navigate={navigate}
          />
        ) : tab === "Reviewers" ? (
          <TeamPanel
            api={api}
            query={query}
            refresh={refresh}
            demo={demo}
            navigate={navigate}
          />
        ) : tab === "Operations" ? (
          <OperationsPanel api={api} refresh={refresh} demo={demo} />
        ) : (
          <EventsPanel api={api} query={query} refresh={refresh} demo={demo} />
        )}
      </div>
    </div>
  );
}
