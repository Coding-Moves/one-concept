import { useState } from "react";
import type { Api } from "./api";
import { Field, Notice, message, useResource } from "./ui";

type Policy = { version: number; deadline_hours: number; reminder_hours: number; max_reminders: number };
type Delivery = { recipient_name?: string | null; id: string; status: string; attempts: number; failure_code: string | null; created_at: string };
type Overview = { policy: Policy; setup_status: string; daily_cap: number; attempts_last_24h: number; overdue: number; counts: Record<string, number>; items: Delivery[]; next_cursor: string | null };
const statuses: Record<string, string> = {
  ready: "Gmail delivery configured", disabled: "Email sending is disabled",
  staging_verification_required: "Staging delivery must be verified before production sending",
  dashboard_setup_required: "The operator needs to configure the reviewer website address",
  sender_setup_required: "The operator needs to configure the existing Gmail sender",
  test_recipients_required: "Staging needs an explicit list of test recipients",
};
export function Notifications({ api }: { api: Api }) {
  const [cursor, setCursor] = useState(""), [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState(false);
  const { data, error: loadError, loading } = useResource<Overview>(api, "/notifications?limit=25" + (cursor ? "&cursor=" + cursor : ""), refresh);
  async function retry(item: Delivery) {
    setBusy(true); setError(""); setNotice("");
    try {
      await api.request(`/notifications/${item.id}/retry`, "POST", { expected_version: item.attempts });
      setNotice("Retry queued. The worker will recheck the assignment before sending.");
      setRefresh(n => n + 1);
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <>
    <div className="page-heading"><p className="eyebrow">REVIEW OPERATIONS</p><h1>Reviewer notifications</h1><p>Assigned lessons, review deadlines, and email delivery.</p></div>
    {(error || loadError) && <Notice error>{error || loadError}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    <button disabled={busy || loading} onClick={() => { setCursor(""); setRefresh(n => n + 1); }}>Refresh delivery status</button>
    {!data ? <Notice>Loading notifications…</Notice> : <>
      <section className="card"><h2>{statuses[data.setup_status] || "Sender setup required"}</h2>
        <p>The review queue stays available when email is disabled or unavailable.</p>
        <p><strong>{data.overdue} overdue lessons</strong>. Open the review queue and filter by Overdue to reassign work or adjust deadlines. Overdue lessons are never approved automatically.</p>
        <p>{data.attempts_last_24h} of {data.daily_cap} sending attempts used in the last 24 hours.</p>
        <p>{data.counts.failed || 0} failed · {data.counts.pending || 0} waiting · {data.counts.sent || 0} accepted by Gmail</p>
      </section>
      <PolicyForm key={data.policy.version} api={api} policy={data.policy} saved={() => { setNotice("Review policy saved."); setRefresh(n => n + 1); }} />
      <section className="card"><h2>Delivery history</h2><p>Gmail acceptance does not confirm inbox delivery. Retries share a five-attempt limit.</p>
        {data.items.length === 0 && <p>No email batches yet.</p>}
        {data.items.map(item => <article key={item.id} className="card">
          <h3>{item.status.replaceAll("_", " ")} · {new Date(item.created_at).toLocaleString()}</h3>
          <p>{item.recipient_name || "Former reviewer"} · Delivery {item.id.slice(0, 8)}</p>
          <p>Attempts: {item.attempts} / 5{item.failure_code ? ` · ${item.failure_code.replaceAll("_", " ")}` : ""}</p>
          {item.status === "failed" && item.attempts < 5 && <button disabled={busy || data.setup_status !== "ready"} onClick={() => void retry(item)}>Queue retry</button>}
        </article>)}
        {data.next_cursor && <button disabled={busy || loading} onClick={() => setCursor(data.next_cursor!)}>Next deliveries</button>}
      </section>
    </>}
  </>;
}
function PolicyForm({ api, policy, saved }: { api: Api; policy: Policy; saved: () => void }) {
  const [deadline, setDeadline] = useState(policy.deadline_hours), [interval, setInterval] = useState(policy.reminder_hours), [maximum, setMaximum] = useState(policy.max_reminders);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try { await api.request("/notifications/policy", "PATCH", { expected_version: policy.version, deadline_hours: deadline, reminder_hours: interval, max_reminders: maximum }); saved(); }
    catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="card"><h2>Review policy</h2>
    <p>Default deadlines apply to new assignments without a date. Reminder changes apply to current assignments; reminders are measured from assignment time. Set the maximum to zero to stop new reminders.</p>
    {error && <Notice error>{error}</Notice>}
    <form onSubmit={save}>
      <Field title="Deadline (hours)"><input type="number" min={1} max={720} required value={deadline} onChange={e => setDeadline(Number(e.target.value))} /></Field>
      <Field title="Reminder interval (hours)"><input type="number" min={1} max={168} required value={interval} onChange={e => setInterval(Number(e.target.value))} /></Field>
      <Field title="Maximum reminders"><input type="number" min={0} max={10} required value={maximum} onChange={e => setMaximum(Number(e.target.value))} /></Field>
      <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save review policy"}</button>
    </form>
  </section>;
}
