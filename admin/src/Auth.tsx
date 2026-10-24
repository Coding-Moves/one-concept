import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Field, Notice, message } from "./ui";
export function Login({
  auth,
}: {
  auth: SupabaseClient;
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
      const result = recovery
        ? await auth.auth.resetPasswordForEmail(email, {
            redirectTo: location.origin + "/auth/callback",
          })
        : await auth.auth.signInWithPassword({ email, password });
      if (result.error)
        throw new Error(
          recovery
            ? "Unable to request a recovery email. Try again later."
            : "Unable to sign in. Check your credentials or contact your administrator.",
        );
      setPassword("");
      if (recovery)
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
            {recovery
                ? "Recover your account"
                : "Welcome back"}
          </h2>
          <p>{recovery ? "Enter your account email to receive a password reset link." : "Sign in with your own invited account to continue."}</p>
          {error && <Notice error>{error}</Notice>}
          {notice && <Notice>{notice}</Notice>}
          <Field title="Email address">
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
          </Field>
          {!recovery && (
            <Field title="Password">
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={1}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          <button className="primary" disabled={busy}>
            {busy
              ? "Please wait…"
              : recovery
                  ? "Send recovery email"
                  : "Sign in"}
          </button>
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
        </form>
        <p className="muted">
          Private workspace · Your learning app account does not automatically
          grant review access.
        </p>
      </section>
    </div>
  );
}

export function AccountSetup({
  auth,
  email,
  flow,
  onPasswordSet,
}: {
  auth: SupabaseClient;
  email: string;
  flow: "invite" | "recovery" | "setup";
  onPasswordSet: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirmation) {
      setError("The passwords do not match.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await auth.auth.updateUser({ password });
      if (error)
        throw new Error("Password could not be saved. Check password requirements and try again.");
      setPassword("");
      setConfirmation("");
      onPasswordSet();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="brand"><span className="brand-mark">1</span> One Concept</div>
        <p className="eyebrow">ONE ACCOUNT · TWO EXPERIENCES</p>
        <h1>Learn and review<br />with one account.</h1>
        <p>Your verified email and password work in both the One Concept learning app and this review workspace. Reviewer access is granted by the owner.</p>
      </section>
      <section className="auth-panel">
        <form onSubmit={submit}>
          <p className="eyebrow">{flow === "invite" ? "INVITATION ACCEPTED" : "ACCOUNT SECURITY"}</p>
          <h2>{flow === "invite" ? "Finish creating your account" : "Set your password"}</h2>
          <p>{flow === "invite" ? "Your email is confirmed. Choose a password to finish setup." : "Choose a new password for your One Concept account."}</p>
          {error && <Notice error>{error}</Notice>}
          <Field title="Verified email"><input type="email" value={email} readOnly /></Field>
          <Field title="Password"><input type="password" autoComplete="new-password" minLength={12} required value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
          <Field title="Confirm password"><input type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={(e) => setConfirmation(e.target.value)} /></Field>
          <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save password and continue"}</button>
        </form>
        <p className="muted">{flow === "invite" ? "After setup, submit your reviewer name for owner approval in Settings. Authenticator use starts off and can be enabled there." : "Your existing reviewer permissions and security settings remain in place."}</p>
      </section>
    </main>
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
