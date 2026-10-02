import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Field, Notice, message } from "./ui";
export function Login({
  auth,
  passwordSetup,
  onPasswordSet,
}: {
  auth: SupabaseClient;
  passwordSetup: boolean;
  onPasswordSet: () => void;
}) {
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [recovery, setRecovery] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = passwordSetup
        ? await auth.auth.updateUser({ password })
        : recovery
          ? await auth.auth.resetPasswordForEmail(email, {
              redirectTo: location.origin + "/auth/callback",
            })
          : await auth.auth.signInWithPassword({ email, password });
      if (result.error)
        throw new Error(
          passwordSetup
            ? "Password could not be updated. Check password requirements and try again."
            : recovery
              ? "Unable to request a recovery email. Try again later."
              : "Unable to sign in. Check your credentials or contact your administrator.",
        );
      setPassword("");
      if (passwordSetup) onPasswordSet();
      else if (recovery)
        setNotice(
          "If this address can recover an account, a password reset email will arrive shortly.",
        );
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-story">
        <div className="brand">
          <span className="brand-mark">1</span> One Concept
        </div>
        <p className="eyebrow">THE REVIEW WORKSPACE</p>
        <h1>
          Good learning starts
          <br />
          with a human review.
        </h1>
        <p>
          A shared space to check every detail, leave useful feedback, and
          publish with confidence.
        </p>
        <div className="steps">
          <span>01 · Read</span>
          <span>02 · Review</span>
          <span>03 · Publish</span>
        </div>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <p className="eyebrow">INVITED REVIEWERS</p>
          <h2>
            {passwordSetup
              ? "Set your password"
              : recovery
                ? "Recover your account"
                : "Welcome back"}
          </h2>
          <p>
            {passwordSetup
              ? "Choose a private password. Your administrator never needs to know it."
              : "Sign in with your own invited account to continue."}
          </p>
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          {!passwordSetup && (
            <Field title="Email address">
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          )}
          {(!recovery || passwordSetup) && (
            <Field title="Password">
              <input
                type="password"
                autoComplete={
                  passwordSetup ? "new-password" : "current-password"
                }
                required
                minLength={passwordSetup ? 12 : 1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : passwordSetup
                ? "Save password"
                : recovery
                  ? "Send recovery email"
                  : "Sign in"}
          </button>
          {!passwordSetup && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setRecovery(!recovery);
                setError("");
                setNotice("");
                setPassword("");
              }}
            >
              {recovery ? "Back to sign in" : "Forgot your password?"}
            </button>
          )}
        </form>
        <p className="muted">
          Private workspace · Your learning app account does not automatically
          grant review access.
        </p>
      </section>
    </div>
  );
}
export function Mfa({
  auth,
  onVerified,
}: {
  auth: SupabaseClient;
  onVerified: () => void;
}) {
  const [factorsReady, setFactorsReady] = useState(false),
    [factors, setFactors] = useState<{ id: string; friendly_name?: string }[]>(
      [],
    ),
    [factor, setFactor] = useState(""),
    [secret, setSecret] = useState(""),
    [qr, setQr] = useState(""),
    [code, setCode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    auth.auth.mfa.listFactors().then(({ data, error }) => {
      if (!active) return;
      if (error) setError("Unable to load authenticators.");
      else {
        setFactorsReady(true);
        setFactors(data.totp);
        setFactor(data.totp[0]?.id || "");
      }
    });
    return () => {
      active = false;
    };
  }, [auth]);
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await auth.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "One Concept " + new Date().toISOString(),
      });
      if (error)
        throw new Error(
          "Unable to add an authenticator. Try again or contact your administrator.",
        );
      setFactor(data.id);
      setSecret(data.totp.secret);
      setQr(data.totp.qr_code);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { error } = await auth.auth.mfa.challengeAndVerify({
        factorId: factor,
        code,
      });
      if (error)
        throw new Error(
          "The code was not accepted. Try the current six-digit code.",
        );
      setSecret("");
      setQr("");
      setCode("");
      onVerified();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card narrow">
      <p className="eyebrow">SECURE ACCESS</p>
      <h1>Verify your authenticator</h1>
      <p>
        Review and publication actions require a code from your authenticator
        app.
      </p>
      {error && <Notice error>{error}</Notice>}
      {!factor ? (
        <button
          className="primary"
          disabled={busy || !factorsReady}
          onClick={enroll}
        >
          Set up authenticator
        </button>
      ) : (
        <form onSubmit={verify}>
          {factors.length > 1 && (
            <Field title="Authenticator">
              <select
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
              >
                {factors.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.friendly_name || "Authenticator"}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {qr && (
            <img
              className="qr"
              src={qr}
              alt="Scan with your authenticator app"
            />
          )}
          {secret && (
            <p>
              Or enter this setup key: <code className="break">{secret}</code>
            </p>
          )}
          <Field title="Six-digit code">
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              pattern="[0-9]{6}"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </Field>
          <button className="primary" disabled={busy}>
            {busy ? "Verifying…" : "Verify and continue"}
          </button>
        </form>
      )}
      <p className="muted">
        Lost access to your authenticator? Contact the trusted project owner for
        account recovery.
      </p>
    </section>
  );
}
