import { useState } from "react";
import { command } from "./api";
import type { Api } from "./api";
import type { Route } from "./App";
import type { Taxon } from "./types";
import { label, shortId } from "./types";
import { Badge, Field, Notice, useResource } from "./ui";
import { useCommand } from "./useCommand";

type Eligibility = {
  eligible_count: number;
  active_batch_id: string | null;
  configured: boolean;
};
type Batch = {
  id: string;
  topic_id: string;
  name: string;
  status: string;
  discovered_count: number;
  quota_limit: number;
  token: string;
  counts: Record<string, number>;
};
type Entry = {
  id: string;
  concept_id: string;
  title: string;
  status: string;
  attempts: number;
  failure_code: string | null;
  result_revision_id: string | null;
};

export function LegacyEnrichment({
  api,
  topics,
  navigate,
}: {
  api: Api;
  topics: [string, string][];
  navigate: (route: Route) => void;
}) {
  const [topic, setTopic] = useState("");
  const [quota, setQuota] = useState(75);
  const [note, setNote] = useState("");
  const [actionNote, setActionNote] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState("");
  const [notice, setNotice] = useState("");
  const eligibility = useResource<Eligibility>(
    api,
    topic ? `/legacy-enrichment-eligibility/${topic}` : "/legacy-enrichment-batches",
    refresh,
  );
  const batches = useResource<{ items: Batch[] }>(
    api,
    "/legacy-enrichment-batches",
    refresh,
  );
  const current = batches.data?.items.find((item) => item.id === selected);
  const entries = useResource<{ items: Entry[] }>(
    api,
    selected ? `/legacy-enrichment-batches/${selected}/entries` : "/legacy-enrichment-batches",
    refresh,
  );
  const create = useCommand(api, (result) => {
    setSelected(String(result.id));
    setNotice("Batch prepared. Start it when you are ready for Gemini calls.");
    setRefresh((value) => value + 1);
  });
  const act = useCommand(api, (_, request) => {
    const body = request.body as { action: string };
    setNotice(`Batch ${body.action === "resume" ? "started" : body.action === "pause" ? "paused" : "cancelled"}.`);
    setRefresh((value) => value + 1);
  });
  const eligibilityReady = !!topic && !eligibility.loading && !!eligibility.data;
  const canPrepare =
    eligibilityReady &&
    !!eligibility.data?.configured &&
    !eligibility.data?.active_batch_id &&
    (eligibility.data?.eligible_count ?? 0) > 0 &&
    quota >= (eligibility.data?.eligible_count ?? Infinity) &&
    quota <= 500 &&
    Number.isInteger(quota) &&
    note.trim().length >= 10 &&
    !create.busy &&
    !create.pending;

  return (
    <section className="card">
      <div className="heading-row">
        <div>
          <h2>Complete existing published lessons</h2>
          <p>Choose one subject. Gemini prepares private revisions with a flashcard, three questions, and grounded sources. A person must review and publish each revision.</p>
        </div>
        <button onClick={() => setRefresh((value) => value + 1)}>Refresh batches</button>
      </div>
      {notice && <Notice>{notice}</Notice>}
      {create.error && <Notice error>{create.error}</Notice>}
      {act.error && <Notice error>{act.error}</Notice>}
      {create.pending && <button onClick={() => void create.retry()}>Retry identical preparation request</button>}
      {act.pending && <button onClick={() => void act.retry()}>Retry identical batch action</button>}
      <Field title="Existing subject">
        <select value={topic} onChange={(event) => setTopic(event.target.value)}>
          <option value="">Choose a subject</option>
          {topics.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
      </Field>
      {topic && (eligibility.error ? <Notice error>{eligibility.error}</Notice> : eligibility.data ? (
        <div className="supply">
          <p><strong>{eligibility.data.eligible_count}</strong> published lessons eligible for a private revision in this subject.</p>
          {!eligibility.data.configured && <Notice>Legacy enrichment is paused or the Gemini 3 provider is not configured.</Notice>}
          {eligibility.data.active_batch_id && <Notice>Finish or cancel the active subject batch before preparing another.</Notice>}
          {!eligibility.data.eligible_count && <Notice>No eligible lessons remain in this subject. Existing drafts may still need human review.</Notice>}
        </div>
      ) : <Notice>Checking published lessons…</Notice>)}
      <Field title="Maximum Gemini calls for this batch">
        <input type="number" min={1} max={500} value={quota} onChange={(event) => setQuota(Number(event.target.value))} />
      </Field>
      <p>Allow at least one call per eligible lesson. Retries count against this limit; no lesson is published automatically.</p>
      <Field title="Reason for this batch">
        <textarea maxLength={4000} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <button className="primary" disabled={!canPrepare} onClick={() => {
        const { expected_token: _, ...body } = command("", note, {
          topic_id: topic,
          name: `legacy-${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID().slice(0, 8)}`,
          quota_limit: quota,
        });
        void create.send({ path: "/legacy-enrichment-batches", method: "POST", body });
      }}>Prepare subject batch</button>
      <div className="heading-row"><h3>Subject batches</h3></div>
      {batches.error && <Notice error>{batches.error}</Notice>}
      {batches.loading ? <Notice>Loading batches…</Notice> : !batches.data?.items.length ? <p>No batches yet.</p> : (
        <div>
          {batches.data.items.map((batch) => <button key={batch.id} className="job" onClick={() => setSelected(batch.id)}>
            <Badge status={batch.status} /> {topics.find(([id]) => id === batch.topic_id)?.[1] || batch.name} · {batch.discovered_count} lessons · #{shortId(batch.id)}
          </button>)}
        </div>
      )}
      {current && <div className="card">
        <h3>{topics.find(([id]) => id === current.topic_id)?.[1] || current.name}</h3>
        <p>{Object.entries(current.counts).map(([status, count]) => `${count} ${label(status)}`).join(" · ") || "Waiting to start"}</p>
        {(current.status === "queued" || current.status === "paused" || current.status === "running") && <>
          <Field title="Reason for batch action">
            <textarea maxLength={4000} value={actionNote} onChange={(event) => setActionNote(event.target.value)} />
          </Field>
          {(["queued", "paused"].includes(current.status) ? ["resume", "cancel"] : ["pause", "cancel"]).map((action) => (
            <button key={action} disabled={actionNote.trim().length < 10 || act.busy || !!act.pending}
              onClick={() => void act.send({ path: `/legacy-enrichment-batches/${current.id}/actions`, method: "POST",
                body: command(current.token, actionNote, { action }) })}>{action === "resume" ? "Start / resume" : label(action)}</button>
          ))}
        </>}
        <h3>Lessons</h3>
        {entries.error && <Notice error>{entries.error}</Notice>}
        {entries.loading ? <Notice>Loading lessons…</Notice> : entries.data?.items.map((entry) => (
          <div className="job heading-row" key={entry.id}>
            <div><strong>{entry.title}</strong> · <Badge status={entry.status} /> · {entry.attempts} calls
              {entry.failure_code ? ` · ${label(entry.failure_code)}` : ""}</div>
            {entry.result_revision_id && <button onClick={() => navigate({ view: "review", kind: "revisions", id: entry.result_revision_id! })}>Review draft</button>}
          </div>
        ))}
      </div>}
    </section>
  );
}
