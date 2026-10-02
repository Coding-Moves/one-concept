import { useState } from "react";
import type { Api } from "./api";
import { capabilities, label } from "./types";
import type { Me, Member, Page, Capability } from "./types";
import { Badge, Field, Notice, message, useResource } from "./ui";
export function Team({ api, me }: { api: Api; me: Me }) {
  const [cursor, setCursor] = useState(""),
    [refresh, setRefresh] = useState(0),
    [email, setEmail] = useState(""),
    [caps, setCaps] = useState<Capability[]>(["review"]),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const {
    data,
    error: loadError,
    loading,
  } = useResource<Page<Member>>(
    api,
    "/reviewers?limit=25" + (cursor ? "&cursor=" + cursor : ""),
    refresh,
  );
  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.request("/reviewers", "POST", { email, capabilities: caps });
      setEmail("");
      setNotice(
        "Membership created. New accounts receive an invitation; existing accounts use their own sign-in or recovery.",
      );
      setRefresh((n) => n + 1);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <p className="eyebrow">TEAM SETTINGS</p>
        <h1>Thoughtful people. Shared standards.</h1>
        <p>
          Separate accounts, clear permissions, and one shared review queue.
        </p>
      </div>
      <section className="card">
        <h2>Invite a reviewer</h2>
        <p>
          Reviewers set their own passwords. Start with your three-person team
          and add others whenever needed.
        </p>
        {error && <Notice error>{error}</Notice>}
        {notice && <Notice>{notice}</Notice>}
        <form onSubmit={invite}>
          <Field title="Reviewer email">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <Permissions values={caps} onChange={setCaps} />
          <button className="primary" disabled={busy}>
            {busy ? "Creating membership…" : "Invite reviewer"}
          </button>
        </form>
      </section>
      <section className="card">
        <div className="heading-row">
          <h2>Reviewer accounts</h2>
          <button
            onClick={() => {
              setCursor("");
              setRefresh((n) => n + 1);
            }}
          >
            Refresh list
          </button>
        </div>
        {loadError && <Notice error>{loadError}</Notice>}
        {loading ? (
          <Notice>Loading reviewers…</Notice>
        ) : (
          data?.items.map((m) => (
            <MemberRow
              key={m.user_id + ":" + m.version}
              api={api}
              member={m}
              self={m.user_id === me.member.user_id}
              changed={() => setRefresh((n) => n + 1)}
            />
          ))
        )}
        <div className="pagination">
          <button disabled={!cursor} onClick={() => setCursor("")}>
            First page
          </button>
          <button
            disabled={!data?.next_cursor}
            onClick={() => setCursor(data!.next_cursor!)}
          >
            Next page
          </button>
        </div>
      </section>
    </>
  );
}
function Permissions({
  values,
  onChange,
}: {
  values: Capability[];
  onChange: (v: Capability[]) => void;
}) {
  return (
    <fieldset>
      <legend>Permissions</legend>
      <div className="checks">
        {capabilities.map((c) => (
          <label key={c}>
            <input
              type="checkbox"
              checked={values.includes(c)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...values, c]
                    : values.filter((x) => x !== c),
                )
              }
            />
            {label(c)}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
function MemberRow({
  api,
  member,
  self,
  changed,
}: {
  api: Api;
  member: Member;
  self: boolean;
  changed: () => void;
}) {
  const [caps, setCaps] = useState(member.capabilities),
    [status, setStatus] = useState(member.status),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function save(approve = false) {
    setBusy(true);
    setError("");
    try {
      await api.request(
        `/reviewers/${member.user_id}/${approve ? "approve-profile" : "access"}`,
        approve ? "POST" : "PATCH",
        {
          expected_version: member.version,
          ...(approve ? {} : { status, capabilities: caps }),
        },
      );
      changed();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="member">
      <summary>
        <strong>{member.approved_name || "Name approval needed"}</strong>
        <span>{member.invited_email}</span>
        <Badge status={member.status} />
      </summary>
      <p>
        Requested name:{" "}
        <strong>{member.requested_name || "Not submitted yet"}</strong>
        {self ? " · Your account" : ""}
      </p>
      {error && <Notice error>{error}</Notice>}
      {member.requested_name !== member.approved_name &&
        member.requested_name &&
        !self && (
          <button disabled={busy} onClick={() => void save(true)}>
            Approve registered name
          </button>
        )}
      <Permissions values={caps} onChange={setCaps} />
      <Field title="Access status">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as "active" | "revoked")}
        >
          <option value="active">Active</option>
          <option value="revoked">Revoked</option>
        </select>
      </Field>
      <button disabled={busy} onClick={() => void save()}>
        Save account access
      </button>
    </details>
  );
}
