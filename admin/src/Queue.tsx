import { useEffect, useState } from "react";
import type { Api } from "./api";
import type { Route } from "./App";
import type { Me, Member, Page, QueueItem, Taxon } from "./types";
import { shortId } from "./types";
import { allPages, Badge, Empty, Field, Notice, useResource } from "./ui";
import { MarkdownText } from "./MarkdownText";
export function Queue({
  api,
  me,
  view,
  navigate,
}: {
  api: Api;
  me: Me;
  view: string;
  navigate: (r: Route) => void;
}) {
  const kind =
    view === "legacy"
      ? "legacy"
      : view === "published"
        ? "published"
        : "revisions";
  const [search, setSearch] = useState(""),
    [topic, setTopic] = useState(""),
    [subtopic, setSubtopic] = useState(""),
    [status, setStatus] = useState(
      view === "approved" ? "approved" : "pending_review",
    ),
    [assignee, setAssignee] = useState(""),
    [urgency, setUrgency] = useState(""),
    [pages, setPages] = useState<string[]>([""]),
    [refresh, setRefresh] = useState(0);
  const [taxonomy, setTaxonomy] = useState<Taxon[]>([]),
    [members, setMembers] = useState<Member[]>([]),
    [filterError, setFilterError] = useState("");
  useEffect(() => {
    let active = true;
    allPages<Taxon>(api, "/taxonomy")
      .then((data) => {
        if (active) setTaxonomy(data);
      })
      .catch(() => {
        if (active)
          setFilterError(
            "Topic filters could not be loaded. Refresh to try again.",
          );
      });
    if (me.member.capabilities.includes("manage_reviewers"))
      allPages<Member>(api, "/reviewers")
        .then((data) => {
          if (active) setMembers(data);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, me.member.user_id, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") setRefresh((n) => n + 1);
    }, 30000);
    return () => clearInterval(timer);
  }, []);
  const params = new URLSearchParams({
    kind,
    limit: "25",
    search,
    ...(topic ? { topic_id: topic } : {}),
    ...(subtopic ? { subtopic_id: subtopic } : {}),
    ...(pages.at(-1) ? { cursor: pages.at(-1)! } : {}),
    ...(kind === "revisions"
      ? {
          ...(status ? { status } : {}),
          ...(assignee ? { assignee_id: assignee } : {}),
          ...(urgency ? { urgency } : {}),
        }
      : {}),
  });
  const { data, error, loading } = useResource<Page<QueueItem>>(
    api,
    "/queue?" + params,
    refresh,
  );
  function filter(set: (v: string) => void, value: string) {
    set(value);
    setPages([""]);
  }
  const topics = [
    ...new Map(taxonomy.map((t) => [t.topic_id, t.topic_name])).entries(),
  ];
  const titles: Record<string, string> = {
    legacy: "Existing lessons",
    approved: "Approved lessons",
    published: "Published library",
  };
  return (
    <>
      <div className="page-heading heading-row">
        <div>
          <p className="eyebrow">HUMAN REVIEW · SHARED TEAM QUEUE</p>
          <h1>{titles[view] || "A little care. Better learning."}</h1>
          <p>
            {view === "published"
              ? "Reviewed lessons already available to eligible learners."
              : view === "approved"
                ? "One approval per revision. These lessons are ready for a permitted publisher."
                : view === "legacy"
                  ? "Existing lessons remain available while your team reviews them."
                  : "Choose a topic, open a lesson, and give it your full attention."}
          </p>
        </div>
        <button
          onClick={() => {
            setFilterError("");
            setRefresh((n) => n + 1);
          }}
        >
          ↻ Refresh
        </button>
      </div>
      <section className="queue-card">
        <div className="queue-top">
          <h2>
            {titles[view] || "Review queue"}{" "}
            <span className="count">{data?.total ?? "…"}</span>
          </h2>
          <span className="muted">
            Shared status · refreshes every 30 seconds
          </span>
        </div>
        <div className="filters">
          <Field title="Search lessons">
            <input
              placeholder="Title…"
              maxLength={120}
              value={search}
              onChange={(e) => filter(setSearch, e.target.value)}
            />
          </Field>
          <Field title="Topic">
            <select
              value={topic}
              onChange={(e) => {
                filter(setTopic, e.target.value);
                setSubtopic("");
              }}
            >
              <option value="">All topics</option>
              {topics.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </select>
          </Field>
          <Field title="Subtopic">
            <select
              value={subtopic}
              onChange={(e) => filter(setSubtopic, e.target.value)}
            >
              <option value="">All subtopics</option>
              {taxonomy
                .filter((t) => !topic || t.topic_id === topic)
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
            </select>
          </Field>
          {kind === "revisions" && (
            <>
              <Field title="Status">
                <select
                  value={status}
                  onChange={(e) => filter(setStatus, e.target.value)}
                >
                  <option value="">All open work</option>
                  {[
                    "pending_review",
                    "draft",
                    "changes_requested",
                    "validation_failed",
                    "approved",
                    "rejected",
                    "published",
                    "retired",
                  ].map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </Field>
              <Field title="Assigned reviewer">
                <select
                  value={assignee}
                  onChange={(e) => filter(setAssignee, e.target.value)}
                >
                  <option value="">Everyone</option>
                  <option value={me.member.user_id}>Assigned to me</option>
                  {members
                    .filter((m) => m.user_id !== me.member.user_id)
                    .map((m) => (
                      <option key={m.user_id} value={m.user_id}>
                        {m.approved_name || m.invited_email}
                      </option>
                    ))}
                </select>
              </Field>
              <Field title="Deadline">
                <select
                  value={urgency}
                  onChange={(e) => filter(setUrgency, e.target.value)}
                >
                  <option value="">Any deadline</option>
                  <option value="overdue">Overdue</option>
                  <option value="scheduled">Upcoming</option>
                  <option value="unscheduled">No deadline</option>
                </select>
              </Field>
            </>
          )}
        </div>
        {filterError && <Notice error>{filterError}</Notice>}
        {error && <Notice error>{error}</Notice>}
        {loading ? (
          <div className="loading" role="status">
            Loading lessons…
          </div>
        ) : data?.items.length ? (
          <div className="lesson-list">
            {data.items.map((item) => (
              <button
                className="lesson-row"
                key={item.id}
                onClick={() => navigate({ view: "review", id: item.id, kind })}
              >
                <span className="lesson-icon" aria-hidden="true">
                  ▤
                </span>
                <span className="lesson-copy">
                  <span className="row-meta">
                    {item.topic_name} <span> / {item.subtopic_name}</span>
                  </span>
                  <strong><MarkdownText value={item.title} inline /></strong>
                  <span className="muted">
                    #{shortId(item.id)} ·{" "}
                    {kind === "revisions"
                      ? `Based on version ${item.base_version}`
                      : `Version ${item.content_version}`}
                    {item.approved_by
                      ? ` · Approved by ${item.approved_by}`
                      : ""}
                    {item.review_due_at
                      ? ` · Due ${new Date(item.review_due_at).toLocaleString()}`
                      : ""}
                  </span>
                </span>
                <span className="row-state">
                  {item.overdue && <Badge status="overdue" />}
                  <Badge
                    status={kind === "legacy" ? "unreviewed" : item.status}
                  />
                  <span aria-hidden="true">→</span>
                </span>
              </button>
            ))}
          </div>
        ) : (
          <Empty title="No lessons in this view">
            Try another topic or status. Your team’s latest decisions appear
            when this queue refreshes.
          </Empty>
        )}
        <footer className="pagination">
          <span>
            {data?.total ?? 0} matching lessons · Page {pages.length}
          </span>
          <div>
            <button
              disabled={pages.length === 1 || loading}
              onClick={() => setPages((p) => p.slice(0, -1))}
            >
              Previous
            </button>
            <button
              disabled={!data?.next_cursor || loading}
              onClick={() =>
                data?.next_cursor && setPages((p) => [...p, data.next_cursor!])
              }
            >
              Next
            </button>
          </div>
        </footer>
      </section>
      <div className="quiet-note">
        ✓ One decision, shared with your team. Approved lessons do not need each
        reviewer’s approval.
      </div>
    </>
  );
}
