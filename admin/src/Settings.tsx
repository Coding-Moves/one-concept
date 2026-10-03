import { useState } from "react";
import type { Api } from "./api";
import type { Me } from "./types";
import { Field, Notice, message } from "./ui";
export function Settings({
  api,
  me,
  reloadMe,
  environment,
}: {
  api: Api;
  me: Me;
  reloadMe: () => Promise<void>;
  environment: string;
}) {
  const [name, setName] = useState(me.member.requested_name || ""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.request("/me/profile", "PATCH", {
        expected_version: me.member.version,
        registered_name: name,
      });
      setSaved(true);
      await reloadMe();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1>
          {me.onboarding_required
            ? "Let’s set up your reviewer profile"
            : "Account & settings"}
        </h1>
        <p>Your approved name is attached to the exact lessons you review.</p>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h2>Reviewer profile</h2>
          {me.name_approval_pending && (
            <Notice>
              Your name is waiting for an administrator’s approval.{" "}
              {me.member.approved_name
                ? "Your current approved name still applies."
                : "You can start reviewing after approval and authenticator verification."}
            </Notice>
          )}
          {saved && <Notice>Name submitted for approval.</Notice>}
          {error && <Notice error>{error}</Notice>}
          <form onSubmit={save}>
            <Field title="Registered name">
              <input
                value={name}
                maxLength={80}
                minLength={2}
                required
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
              />
            </Field>
            <Field title="Invited email">
              <input value={me.member.invited_email} readOnly />
            </Field>
            <p>
              Approved name:{" "}
              <strong>{me.member.approved_name || "Awaiting approval"}</strong>
            </p>
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Submit name for approval"}
            </button>
            <button type="button" onClick={() => void reloadMe()}>
              Refresh account status
            </button>
          </form>
        </section>
        <Timezone key={me.member.version} api={api} me={me} reloadMe={reloadMe} />
        <section className="card">
          <h2>Workspace details</h2>
          <dl>
            <dt>Environment</dt>
            <dd>{environment}</dd>
            <dt>Account access</dt>
            <dd>{me.member.status}</dd>
            <dt>Authenticator</dt>
            <dd>
              {me.mfa_required
                ? "Verification required before review"
                : "Verified for this session"}
            </dd>
            <dt>Permissions</dt>
            <dd>
              {me.member.capabilities.join(", ") || "No editorial permissions"}
            </dd>
          </dl>
          <p className="muted">
            Only the workspace owner can change permissions. Approved name
            changes apply to future reviews; past signatures stay unchanged.
          </p>
        </section>
      </div>
    </>
  );
}

function Timezone({ api, me, reloadMe }: { api: Api; me: Me; reloadMe: () => Promise<void> }) {
  const [zone, setZone] = useState(me.member.notification_timezone || "UTC");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError("");
    try {
      await api.request("/me/notification-timezone", "PATCH", { expected_version: me.member.version, timezone: zone });
      await reloadMe();
    } catch (e) { setError(message(e)); } finally { setBusy(false); }
  }
  return <section className="card"><h2>Email deadline timezone</h2><p>Email deadlines use this timezone. Previously queued emails keep their original times.</p>
    {error && <Notice error>{error}</Notice>}
    <form onSubmit={save}><Field title="IANA timezone"><input value={zone} maxLength={80} required placeholder="Asia/Karachi" onChange={e => setZone(e.target.value)} /></Field>
      <button type="button" onClick={() => setZone(Intl.DateTimeFormat().resolvedOptions().timeZone)}>Use device timezone</button>
      <button disabled={busy}>Save timezone</button>
    </form>
  </section>;
}
