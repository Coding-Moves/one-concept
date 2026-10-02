import { useEffect, useRef, useState } from "react";
import { ApiError, command } from "./api";
import type { Api } from "./api";
import type { Route } from "./App";
import { checklist, label, shortId } from "./types";
import type {
  CheckKey,
  Detail,
  Event,
  Job,
  Lesson,
  Me,
  Member,
  Page,
  Revision,
} from "./types";
import { allPages, Badge, Field, Notice, message } from "./ui";
import { LessonEditor, LessonView, Value } from "./LessonView";
import { editableLesson } from "./lesson";
import { useCommand } from "./useCommand";
export function Review({
  api,
  me,
  id,
  kind,
  navigate,
  setDirty,
}: {
  api: Api;
  me: Me;
  id: string;
  kind: string;
  navigate: (r: Route) => void;
  setDirty: (v: boolean) => void;
}) {
  const revision = kind === "revisions",
    path = revision ? `/revisions/${id}` : `/concepts/${id}`;
  const [detail, setDetail] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [note, setNote] = useState(""),
    [checks, setChecks] = useState<Partial<Record<CheckKey, boolean>>>({}),
    [sensitive, setSensitive] = useState(""),
    [tab, setTab] = useState("lesson"),
    [stale, setStale] = useState(false),
    [edit, setEdit] = useState<Lesson | null>(null),
    [stageToken, setStageToken] = useState(""),
    [members, setMembers] = useState<Member[]>([]),
    [assignee, setAssignee] = useState(""),
    [due, setDue] = useState("");
  const [events, setEvents] = useState<Page<Event>>({
      items: [],
      next_cursor: null,
    }),
    [historyRows, setHistory] = useState<Page<Revision>>({
      items: [],
      next_cursor: null,
    }),
    [jobs, setJobs] = useState<Job[]>([]);
  const sequence = useRef(0),
    current = useRef<Detail | null>(null),
    cid = detail?.concept_id || id;
  const can = (cap: string) => me.member.capabilities.includes(cap as never);
  async function load() {
    const seq = ++sequence.current;
    setError("");
    try {
      const d = await api.request<Detail>(path);
      if (seq !== sequence.current) return;
      setDetail(d);
      current.current = d;
      setStale(false);
      setChecks({});
      setSensitive("");
      setAssignee(d.assigned_to || "");
      setDue(d.review_due_at ? localTime(d.review_due_at) : "");
      const concept = d.concept_id || id;
      const [ev, hs] = await Promise.all([
        api.request<Page<Event>>(`/concepts/${concept}/timeline`),
        api.request<Page<Revision>>(`/concepts/${concept}/revisions`),
      ]);
      if (seq !== sequence.current) return;
      setEvents(ev);
      setHistory(hs);
    } catch (e) {
      if (seq === sequence.current) setError(message(e));
    }
  }
  const op = useCommand(api, async (result) => {
    setNote("");
    setChecks({});
    setSensitive("");
    setEdit(null);
    setDirty(false);
    setNotice(
      result.status === "published"
        ? `Published successfully${result.published_version ? " · version " + result.published_version : ""}. Eligible learners can receive this content through normal app requests.`
        : result.status === "approved"
          ? "Approved for the whole team. No additional reviewer approval is needed."
          : result.status === "validation_failed"
            ? "Submission needs corrections. Review the validation errors below."
            : result.status === "pending"
              ? "AI correction queued. It will return as a new draft for human review."
              : "Saved successfully.",
    );
    await load();
    if (result.revision_id && result.revision_id !== id)
      navigate({
        view: "review",
        id: String(result.revision_id),
        kind: "revisions",
      });
  });
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [path]);
  useEffect(() => {
    let active = true;
    if (can("manage_reviewers"))
      allPages<Member>(api, "/reviewers")
        .then((v) => {
          if (active) setMembers(v);
        })
        .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  useEffect(() => {
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible" || !current.current) return;
      try {
        const fresh = await api.request<Detail>(path);
        if (current.current && fresh.token !== current.current.token)
          setStale(true);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 499)) setError(message(e));
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [api, path]);
  useEffect(() => {
    let active = true;
    allPages<Job>(api, "/generation-jobs?concept_id=" + cid)
      .then((rows) => {
        if (active) setJobs(rows.filter((j) => j.concept_id === cid));
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api, cid, detail?.token]);
  useEffect(() => {
    setDirty(!!note || !!edit || !!op.pending);
    return () => setDirty(false);
  }, [note, edit, op.pending]);
  if (!detail)
    return (
      <section className="card">
        {error ? (
          <Notice error>{error}</Notice>
        ) : (
          <Notice>Opening the complete lesson…</Notice>
        )}
        <button onClick={() => void load()}>Reload lesson</button>
      </section>
    );
  const approvalKeys = Object.keys(checklist) as CheckKey[];
  const complete = approvalKeys.every((k) => checks[k]) && !!sensitive;
  const blocked = op.busy || !!op.pending || op.conflict || stale;
  const decisionBlocked = blocked || !!edit;
  const noted = note.trim().length >= 10;
  const quality = {
    ...Object.fromEntries(approvalKeys.map((k) => [k, !!checks[k]])),
    sensitive_topic_handling: sensitive,
  };
  function act(action: string, extra: Record<string, unknown> = {}) {
    void op.send({
      path: path + "/actions",
      method: "POST",
      body: command(detail!.token, note, { action, ...extra }),
    });
  }
  async function beginEdit() {
    try {
      const concept = await api.request<Detail>(`/concepts/${cid}`);
      setStageToken(concept.token);
      setEdit({
        ...editableLesson(detail!.body),
        subtopic_slug: concept.body.subtopic_slug,
      });
      setTab("edit");
    } catch (e) {
      setError(message(e));
    }
  }
  async function more(which: "events" | "history") {
    try {
      if (which === "events" && events.next_cursor) {
        const p = await api.request<Page<Event>>(
          `/concepts/${cid}/timeline?cursor=${encodeURIComponent(events.next_cursor)}`,
        );
        setEvents({
          items: [...events.items, ...p.items],
          next_cursor: p.next_cursor,
        });
      }
      if (which === "history" && historyRows.next_cursor) {
        const p = await api.request<Page<Revision>>(
          `/concepts/${cid}/revisions?cursor=${historyRows.next_cursor}`,
        );
        setHistory({
          items: [...historyRows.items, ...p.items],
          next_cursor: p.next_cursor,
        });
      }
    } catch (e) {
      setError(message(e));
    }
  }
  const approvedBy = detail.approved_by || detail.provenance?.registered_name;
  return (
    <>
      <button
        className="text-button"
        onClick={() =>
          navigate({
            view:
              kind === "published"
                ? "published"
                : kind === "legacy"
                  ? "legacy"
                  : "queue",
          })
        }
      >
        ← Back to lessons
      </button>
      <div className="page-heading heading-row">
        <div>
          <p className="eyebrow">
            {revision ? "REVISION" : "LESSON"} #{shortId(id)} ·{" "}
            {revision ? "BASE" : "CONTENT"} VERSION{" "}
            {detail.base_version ?? detail.content_version}
          </p>
          <h1>
            {typeof detail.body?.title === "string"
              ? detail.body.title
              : "Lesson needing correction"}
          </h1>
          <p>
            {approvedBy
              ? `Approved by ${approvedBy}. This decision is shared with every reviewer.`
              : "Read the complete package before recording a decision."}
          </p>
        </div>
        <Badge status={detail.status} />
      </div>
      {notice && <Notice>{notice}</Notice>}
      {(error || op.error) && <Notice error>{error || op.error}</Notice>}
      {(stale || op.conflict) && (
        <Notice error>
          Another decision or edit may have changed this lesson. Your feedback
          is preserved. Reload the latest version and review it again before
          submitting.
        </Notice>
      )}
      {op.pending && (
        <Notice>
          No result is confirmed yet.{" "}
          <button disabled={op.busy} onClick={() => void op.retry()}>
            Retry identical request
          </button>
        </Notice>
      )}
      <div className="review-grid">
        <section className="review-main">
          <div className="tabs" aria-label="Lesson sections">
            {["lesson", "changes", "history", ...(edit ? ["edit"] : [])].map(
              (t) => (
                <button
                  key={t}
                  aria-pressed={tab === t}
                  className={tab === t ? "selected" : ""}
                  onClick={() => setTab(t)}
                >
                  {label(t)}
                </button>
              ),
            )}
          </div>
          <div className="card document-card">
            {tab === "lesson" ? (
              detail.validation.valid ? (
                <LessonView body={detail.body} links={detail.source_links} />
              ) : (
                <>
                  <Notice error>
                    This package needs structural corrections. Its complete
                    original content is shown below.
                  </Notice>
                  <Value value={detail.body} />
                </>
              )
            ) : tab === "changes" ? (
              <>
                <h2>Changes from the current lesson</h2>
                <p>
                  Compare every changed field, including practice questions and
                  references.
                </p>
                {detail.diff?.length ? (
                  detail.diff.map((d) => (
                    <section key={d.field}>
                      <h3>{label(d.field)}</h3>
                      <div className="diff">
                        <div>
                          <span className="eyebrow">CURRENT</span>
                          <Value value={d.before} />
                        </div>
                        <div>
                          <span className="eyebrow">THIS REVISION</span>
                          <Value value={d.after} />
                        </div>
                      </div>
                    </section>
                  ))
                ) : (
                  <p>No field differences are available for this view.</p>
                )}
              </>
            ) : tab === "edit" && edit ? (
              <>
                <h2>Prepare a new revision</h2>
                <button
                  disabled={op.busy || !!op.pending}
                  onClick={() => {
                    if (confirm("Discard the unsaved lesson edits?")) {
                      setEdit(null);
                      setTab("lesson");
                    }
                  }}
                >
                  Discard edits
                </button>
                <p>
                  Your edits create a new draft. They never overwrite the live
                  lesson or another reviewer’s decision.
                </p>
                <fieldset disabled={op.busy || !!op.pending}>
                  <legend>Lesson correction</legend>
                  <LessonEditor body={edit} onChange={setEdit} />
                </fieldset>
                <button
                  className="primary"
                  disabled={blocked || !noted}
                  onClick={() =>
                    void op.send({
                      path: `/concepts/${cid}/revisions`,
                      method: "POST",
                      body: command(stageToken, note, { body: edit }),
                    })
                  }
                >
                  Save as new draft
                </button>
              </>
            ) : (
              <>
                <h2>Revision history</h2>
                {historyRows.items.map((r) => (
                  <button
                    className="history-row"
                    key={r.id}
                    onClick={() =>
                      navigate({ view: "review", id: r.id, kind: "revisions" })
                    }
                  >
                    Revision #{shortId(r.id)} · base v{r.base_version}{" "}
                    <Badge status={r.status} />
                  </button>
                ))}
                {historyRows.next_cursor && (
                  <button onClick={() => void more("history")}>
                    Load more revisions
                  </button>
                )}
                <h2>Comments & decisions</h2>
                {events.items.map((e) => (
                  <article className="event" key={e.id}>
                    <div>
                      <strong>{e.registered_name}</strong> · {label(e.action)}
                    </div>
                    <small>{new Date(e.created_at).toLocaleString()}</small>
                    <Value value={e.note} />
                  </article>
                ))}
                {events.next_cursor && (
                  <button onClick={() => void more("events")}>
                    Load more activity
                  </button>
                )}
              </>
            )}
          </div>
        </section>
        <aside className="review-aside">
          <section className="card">
            <div className="heading-row">
              <h2>Review this lesson</h2>
              <button
                disabled={op.busy || !!op.pending}
                onClick={() => {
                  op.reset();
                  void load();
                }}
              >
                Reload
              </button>
            </div>
            {detail.validation.valid ? (
              <p className="valid">✓ Structural checks passed</p>
            ) : (
              <Notice error>
                <strong>Corrections needed</strong>
                <ul>
                  {detail.validation.errors.map((e, i) => (
                    <li key={i}>
                      {e.field}: {e.message}
                    </li>
                  ))}
                </ul>
              </Notice>
            )}
            <p className="muted">
              Automated checks do not verify facts. Read every section and check
              the sources.
            </p>
            {((revision &&
              detail.status === "pending_review" &&
              can("approve")) ||
              (!revision &&
                kind === "legacy" &&
                detail.unchanged_legacy &&
                can("approve") &&
                can("publish"))) && (
              <fieldset disabled={decisionBlocked}>
                <legend>Human review checklist</legend>
                <div className="checks vertical">
                  {approvalKeys.map((k) => (
                    <label key={k}>
                      <input
                        type="checkbox"
                        checked={!!checks[k]}
                        onChange={(e) =>
                          setChecks({ ...checks, [k]: e.target.checked })
                        }
                      />
                      {checklist[k]}
                    </label>
                  ))}
                </div>
                <Field title="Sensitive content">
                  <select
                    value={sensitive}
                    onChange={(e) => setSensitive(e.target.value)}
                  >
                    <option value="">Choose after review</option>
                    <option value="not_applicable">Not applicable</option>
                    <option value="reviewed">Reviewed for safe handling</option>
                  </select>
                </Field>
              </fieldset>
            )}
            <Field title="Review note or comment">
              <textarea
                rows={5}
                maxLength={4000}
                value={note}
                disabled={op.busy || !!op.pending}
                placeholder="What did you check? What should change? (At least 10 characters)"
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {revision &&
              ["changes_requested", "validation_failed", "rejected"].includes(
                detail.status,
              ) && (
                <p>
                  Prepare a new correction draft before submitting this lesson
                  for review again.
                </p>
              )}
            <div className="decision-buttons">
              {revision &&
                detail.status === "pending_review" &&
                can("approve") && (
                  <button
                    className="primary"
                    disabled={
                      decisionBlocked ||
                      !noted ||
                      !complete ||
                      !detail.validation.valid
                    }
                    onClick={() =>
                      act(can("publish") ? "approve_and_publish" : "approved", {
                        quality,
                      })
                    }
                  >
                    {can("publish")
                      ? "Approve and publish"
                      : "Approve revision"}
                  </button>
                )}
              {revision && detail.status === "approved" && can("publish") && (
                <button
                  className="primary"
                  disabled={
                    decisionBlocked || !noted || !detail.validation.valid
                  }
                  onClick={() => act("publish")}
                >
                  Publish approved revision
                </button>
              )}
              {revision && detail.status === "draft" && (
                <button
                  className="primary"
                  disabled={decisionBlocked || !noted}
                  onClick={() => act("submit")}
                >
                  Submit for review
                </button>
              )}
              {revision && detail.status === "pending_review" && (
                <>
                  <button
                    disabled={decisionBlocked || !noted}
                    onClick={() => act("changes_requested")}
                  >
                    Request changes
                  </button>
                  <button
                    className="danger"
                    disabled={decisionBlocked || !noted}
                    onClick={() => act("rejected")}
                  >
                    Reject revision
                  </button>
                </>
              )}
              {
                <button
                  disabled={decisionBlocked || !noted}
                  onClick={() => act("comment")}
                >
                  Add comment
                </button>
              }
              {!revision &&
                kind === "legacy" &&
                detail.unchanged_legacy &&
                can("approve") &&
                can("publish") && (
                  <button
                    className="primary"
                    disabled={
                      decisionBlocked ||
                      !noted ||
                      !complete ||
                      !detail.validation.valid
                    }
                    onClick={() => act("attest", { quality })}
                  >
                    Verify existing lesson
                  </button>
                )}
              {revision &&
                detail.status === "changes_requested" &&
                can("request_generation") && (
                  <button
                    disabled={decisionBlocked || !noted}
                    onClick={() =>
                      void op.send({
                        path: path + "/generation-requests",
                        method: "POST",
                        body: command(detail.token, note),
                      })
                    }
                  >
                    Request AI correction
                  </button>
                )}
              <button
                disabled={decisionBlocked}
                onClick={() => void beginEdit()}
              >
                Prepare manual correction
              </button>
            </div>
            {(detail.status === "approved" ||
              detail.status === "published") && (
              <p className="valid">
                ✓ Already approved for the team. No second approval needed.
              </p>
            )}
          </section>
          {can("manage_reviewers") &&
            revision &&
            !["published", "retired"].includes(detail.status) && (
              <section className="card">
                <h2>Assignment & deadline</h2>
                <Field title="Assign to">
                  <select
                    value={assignee}
                    onChange={(e) => setAssignee(e.target.value)}
                  >
                    <option value="">Unassigned</option>
                    {members
                      .filter(
                        (m) =>
                          m.status === "active" &&
                          m.approved_name &&
                          m.capabilities.some(
                            (c) => c === "review" || c === "approve",
                          ),
                      )
                      .map((m) => (
                        <option key={m.user_id} value={m.user_id}>
                          {m.approved_name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Field title="Review due (your local time)">
                  <input
                    type="datetime-local"
                    value={due}
                    onChange={(e) => setDue(e.target.value)}
                  />
                </Field>
                <button
                  disabled={decisionBlocked || !noted}
                  onClick={() =>
                    act("assign", {
                      assignee_id: assignee || null,
                      review_due_at: due ? new Date(due).toISOString() : null,
                    })
                  }
                >
                  Save assignment
                </button>
                <p className="muted">
                  A deadline never approves or publishes a lesson automatically.
                </p>
              </section>
            )}
          {jobs.length > 0 && (
            <section className="card">
              <h2>AI corrections</h2>
              {jobs.map((job) => (
                <div className="job" key={job.id}>
                  <Badge status={job.status} />
                  <p>
                    Request #{shortId(job.id)} · {job.attempts}/3 attempts
                  </p>
                  {job.failure_code && <p>{label(job.failure_code)}</p>}
                  {job.result_revision_id && (
                    <button
                      onClick={() =>
                        navigate({
                          view: "review",
                          kind: "revisions",
                          id: job.result_revision_id!,
                        })
                      }
                    >
                      Open corrected draft
                    </button>
                  )}
                  {can("request_generation") &&
                    ["pending", "generating"].includes(job.status) && (
                      <button
                        disabled={decisionBlocked || !noted}
                        onClick={() =>
                          void op.send({
                            path: `/generation-jobs/${job.id}/cancel`,
                            method: "POST",
                            body: command(job.token, note),
                          })
                        }
                      >
                        Cancel AI request
                      </button>
                    )}
                </div>
              ))}
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
function localTime(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
