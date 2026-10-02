import { useEffect, useState } from "react";
import { command } from "./api";
import type { Api } from "./api";
import type { Route } from "./App";
import type { Job, Page, Supply, Taxon } from "./types";
import { label, shortId } from "./types";
import { allPages, Badge, Field, Notice, useResource } from "./ui";
import { useCommand } from "./useCommand";
export function Generation({
  api,
  navigate,
}: {
  api: Api;
  navigate: (r: Route) => void;
}) {
  const [taxonomy, setTaxonomy] = useState<Taxon[]>([]),
    [topic, setTopic] = useState(""),
    [count, setCount] = useState(1),
    [note, setNote] = useState(""),
    [notice, setNotice] = useState(""),
    [refresh, setRefresh] = useState(0),
    [cursor, setCursor] = useState("");
  useEffect(() => {
    let active = true;
    allPages<Taxon>(api, "/taxonomy")
      .then((v) => {
        if (active) setTaxonomy(v);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [api]);
  const jobs = useResource<Page<Job>>(
    api,
    "/generation-jobs?limit=25" +
      (topic ? "&topic_id=" + topic : "") +
      (cursor ? "&cursor=" + cursor : ""),
    refresh,
  );
  const op = useCommand(api, () => {
    setNote("");
    setNotice(
      "Demand recorded. The scheduled worker will prepare private drafts within the available quota and review capacity.",
    );
    setRefresh((n) => n + 1);
  });
  const topics = [
    ...new Map(
      taxonomy
        .filter((t) => t.is_active && t.topic_active)
        .map((t) => [t.topic_id, t.topic_name]),
    ).entries(),
  ];
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">BOUNDED GENERATION</p>
        <h1>Prepare the next good lesson.</h1>
        <p>
          Request planned content or follow a correction. Everything returns for
          human review.
        </p>
      </div>
      <section className="card">
        <h2>Request new drafts</h2>
        {notice && <Notice>{notice}</Notice>}
        {op.error && <Notice error>{op.error}</Notice>}
        {op.pending && (
          <button onClick={() => void op.retry()}>
            Retry identical request
          </button>
        )}
        <Field title="Topic">
          <select
            value={topic}
            onChange={(e) => {
              setTopic(e.target.value);
              setCursor("");
            }}
          >
            <option value="">Choose a topic</option>
            {topics.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
        </Field>
        {topic && <SupplyView api={api} topic={topic} refresh={refresh} />}
        <Field title="Requested drafts">
          <input
            type="number"
            min={1}
            max={10}
            value={count}
            onChange={(e) => setCount(Number(e.target.value))}
          />
        </Field>
        <Field title="Request note">
          <textarea
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        <button
          className="primary"
          disabled={
            !topic ||
            note.trim().length < 10 ||
            count < 1 ||
            count > 10 ||
            !Number.isInteger(count) ||
            op.busy ||
            !!op.pending
          }
          onClick={() => {
            const { expected_token: _, ...body } = command("", note, {
              topic_id: topic,
              count,
            });
            void op.send({
              path: "/generation-requests",
              method: "POST",
              body,
            });
          }}
        >
          Request drafts
        </button>
      </section>
      <section className="card">
        <div className="heading-row">
          <h2>AI correction requests</h2>
          <button onClick={() => setRefresh((n) => n + 1)}>
            Refresh status
          </button>
        </div>
        {jobs.error && <Notice error>{jobs.error}</Notice>}
        {jobs.loading ? (
          <Notice>Loading requests…</Notice>
        ) : jobs.data?.items.length ? (
          jobs.data.items.map((j) => (
            <div className="job heading-row" key={j.id}>
              <div>
                <Badge status={j.status} />
                <p>
                  #{shortId(j.id)} · {j.attempts}/3 attempts
                  {j.failure_code ? " · " + label(j.failure_code) : ""}
                </p>
              </div>
              <button
                onClick={() =>
                  navigate({
                    view: "review",
                    kind: "revisions",
                    id: j.result_revision_id || j.source_revision_id,
                  })
                }
              >
                {j.result_revision_id ? "Review result" : "Open source"}
              </button>
            </div>
          ))
        ) : (
          <p>No requests in this view.</p>
        )}
        <div className="pagination">
          <button disabled={!cursor} onClick={() => setCursor("")}>
            First page
          </button>
          <button
            disabled={!jobs.data?.next_cursor}
            onClick={() => setCursor(jobs.data!.next_cursor!)}
          >
            Next page
          </button>
        </div>
      </section>
    </>
  );
}
function SupplyView({
  api,
  topic,
  refresh,
}: {
  api: Api;
  topic: string;
  refresh: number;
}) {
  const { data, error } = useResource<Supply>(
    api,
    "/generation-supply/" + topic,
    refresh,
  );
  return error ? (
    <Notice error>{error}</Notice>
  ) : data ? (
    <div className="supply">
      <p>
        <strong>{data.published}</strong> published ·{" "}
        <strong>{data.drafts}</strong> drafts · <strong>{data.pending}</strong>{" "}
        planned
      </p>
      <p>
        Review capacity: {data.review_load}/{data.review_capacity}
      </p>
      {data.review_blocked && (
        <Notice>Review queue is full. Finish existing work first.</Notice>
      )}
      {data.planning_required && (
        <Notice>
          New curriculum needs to be planned before generation can continue.
        </Notice>
      )}
      {(!data.generation_enabled || !data.provider_configured) && (
        <Notice>Generation is paused or not configured.</Notice>
      )}
    </div>
  ) : (
    <Notice>Checking supply…</Notice>
  );
}
