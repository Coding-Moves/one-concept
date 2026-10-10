import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, type Api } from "./api";
import type { Me } from "./types";
import { Field, Notice, message } from "./ui";

interface Factor { id: string; friendly_name?: string }

export function AuthenticatorSetting({ auth, api, me, reloadMe }: {
  auth: SupabaseClient;
  api: Api;
  me: Me;
  reloadMe: () => Promise<void>;
}) {
  const [confirmOff, setConfirmOff] = useState(false);
  const [factors, setFactors] = useState<Factor[]>([]);
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function checkAccount() {
    const { data, error } = await auth.auth.getSession();
    if (error || data.session?.user.id !== me.member.user_id)
      throw new Error("Your account changed. Sign in again before changing this setting.");
  }

  async function beginDisable() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await checkAccount();
      const { data, error } = await auth.auth.mfa.listFactors();
      if (error) throw new Error("Unable to load your authenticators. Try again.");
      const verified = data.totp.filter((item) => item.status === "verified");
      if (!verified.length) throw new Error("Set up and verify an authenticator before turning this requirement off.");
      setFactors(verified);
      setFactor(verified[0].id);
      setConfirmOff(true);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function save(required: boolean) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await checkAccount();
      if (!required) {
        const { error } = await auth.auth.mfa.challengeAndVerify({ factorId: factor, code });
        if (error) throw new Error("The authenticator code was not accepted. Try the current six-digit code.");
        await checkAccount();
      }
      await api.request("/me/authenticator", "PATCH", {
        expected_version: me.member.version,
        require_mfa: required,
      });
      setConfirmOff(false);
      setCode("");
      setNotice(required
        ? "Authenticator is required for future sign-ins. Verify it before reviewing."
        : "Authenticator is off. Future sign-ins can use your password alone.");
      await reloadMe();
    } catch (e) {
      setError(e instanceof ApiError && e.status === 409
        ? "Account settings changed elsewhere. Refresh account status and try again."
        : message(e));
    } finally {
      setBusy(false);
    }
  }

  return <section className="card">
    <h2>Sign-in security</h2>
    <p>Choose whether your authenticator app is required to open this review workspace.</p>
    {error && <Notice error>{error}</Notice>}
    {notice && <Notice>{notice}</Notice>}
    <label className="security-switch">
      <span><strong>Require authenticator</strong><small>{me.member.require_mfa
        ? "On · password and authenticator code"
        : "Off · password alone can open the workspace"}</small></span>
      <input type="checkbox" role="switch" checked={me.member.require_mfa} disabled={busy}
        onChange={() => me.member.require_mfa ? void beginDisable() : void save(true)} />
    </label>
    {confirmOff && <form onSubmit={(event) => { event.preventDefault(); void save(false); }}>
      <Notice>Turning this off lets anyone with your password access your review permissions. Your authenticator stays enrolled, so you can turn the requirement back on later.</Notice>
      {factors.length > 1 && <Field title="Authenticator"><select value={factor} onChange={(event) => setFactor(event.target.value)}>
        {factors.map((item) => <option key={item.id} value={item.id}>{item.friendly_name || "Authenticator"}</option>)}
      </select></Field>}
      <Field title="Current six-digit code"><input inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" required value={code} onChange={(event) => setCode(event.target.value)} /></Field>
      <div className="actions"><button type="submit" className="primary" disabled={busy}>{busy ? "Verifying…" : "Confirm and turn off"}</button>
        <button type="button" disabled={busy} onClick={() => { setConfirmOff(false); setCode(""); setError(""); }}>Cancel</button></div>
    </form>}
  </section>;
}
