import { useState } from "react";
import { createRoot } from "react-dom/client";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { readConfig } from "./config";
import { accountCallbackPath, callbackUrl, emailReturn } from "./publicAccountLink";
import { minimumPasswordLength, passwordInputError, passwordUpdateError } from "./passwordPolicy";
import "./publicAccount.css";

type Mode = "sign-in" | "sign-up" | "forgot" | "check-email" | "reset";
type Initial = { user: User | null; mode: Mode; notice: string; error: string };
const recoveryMarker = "one-concept-public-recovery";

function Account({ auth, initial }: { auth: SupabaseClient; initial: Initial }) {
  const [user, setUser] = useState(initial.user);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [email, setEmail] = useState(initial.user?.email || "");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(initial.notice);
  const [error, setError] = useState(initial.error);
  const [emailKind, setEmailKind] = useState<"signup" | "recovery">("signup");
  const [factors, setFactors] = useState<{ id: string; friendly_name?: string }[]>([]);
  const [factor, setFactor] = useState("");
  const [code, setCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setPassword("");
    setConfirmation("");
    setNotice("");
    setError("");
    setNeedsMfa(false);
    setCode("");
  }

  async function verifyResetAccount() {
    const verified = await auth.auth.getUser();
    if (verified.error || !verified.data.user) throw new Error("verify");
    if (verified.data.user.id !== user?.id ||
        sessionStorage.getItem(recoveryMarker) !== verified.data.user.id) {
      sessionStorage.removeItem(recoveryMarker);
      setUser(verified.data.user);
      setMode("sign-in");
      throw new Error("account");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === "sign-up" || mode === "reset") {
      const inputError = passwordInputError(password, confirmation);
      if (inputError) { setError(inputError); return; }
    }
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (mode === "sign-in") {
        const result = await auth.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error || !result.data.user) throw new Error("signin");
        setUser(result.data.user);
        setPassword("");
      } else if (mode === "sign-up") {
        const result = await auth.auth.signUp({
          email: email.trim(), password,
          options: { emailRedirectTo: callbackUrl(location.origin) },
        });
        if (result.error) throw new Error(result.error.status === 429 ? "rate"
          : result.error.code === "weak_password" ? "weak" : "send");
        setPassword("");
        setConfirmation("");
        if (result.data.session && result.data.user) {
          setUser(result.data.user);
          setNotice("Your account is ready. You can use this same account in the One Concept app.");
        } else {
          setEmailKind("signup");
          setMode("check-email");
          setNotice("If this address can register, a confirmation email will arrive shortly.");
        }
      } else if (mode === "forgot") {
        const result = await auth.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: callbackUrl(location.origin),
        });
        if (result.error) throw new Error(result.error.status === 429 ? "rate" : "send");
        setEmailKind("recovery");
        setMode("check-email");
        setNotice("If this address can recover an account, a reset email will arrive shortly.");
      } else if (mode === "reset") {
        await verifyResetAccount();
        if (needsMfa) {
          const challenge = await auth.auth.mfa.challengeAndVerify({ factorId: factor, code });
          if (challenge.error) throw new Error("mfa-code");
          setCode("");
          setNeedsMfa(false);
          await verifyResetAccount();
        }
        const result = await auth.auth.updateUser({ password });
        if (result.error && (result.error.code === "insufficient_aal" || result.error.message.includes("AAL2 session is required to update email or password"))) {
          const listed = await auth.auth.mfa.listFactors();
          const verifiedFactors = listed.data?.totp.filter(item => item.status === "verified") || [];
          if (listed.error || !verifiedFactors.length) throw new Error("mfa-unavailable");
          setFactors(verifiedFactors);
          setFactor(verifiedFactors[0].id);
          setNeedsMfa(true);
          throw new Error("mfa-required");
        }
        if (result.error) { setError(passwordUpdateError(result.error)); return; }
        sessionStorage.removeItem(recoveryMarker);
        const signedOut = await auth.auth.signOut({ scope: "local" });
        if (!signedOut.error) setUser(null);
        setPassword("");
        setConfirmation("");
        setMode("sign-in");
        setNotice(signedOut.error
          ? "Password updated. Please sign out of this browser when finished."
          : "Password updated. Sign in with your new password.");
      }
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : "";
      setError(code === "rate" ? "Too many email requests. Wait a while and try again."
        : code === "weak" ? "Choose a stronger password. Use at least 12 characters and follow your account's security requirements."
        : code === "same" ? "Choose a password different from your current one."
        : code === "signin" ? "Unable to sign in. Check your email and password, then try again."
        : code === "verify" ? "Could not verify this reset session. Check your connection and try again."
        : code === "account" ? "The account changed before the password was updated. Sign out and request a new reset link."
        : code === "mfa-required" ? "Enter the current code from your authenticator app, then update your password again."
        : code === "mfa-code" ? "The authenticator code was not accepted. Try the current six-digit code."
        : code === "mfa-unavailable" ? "This account needs an authenticator to change its password. Contact your account administrator if you cannot access it."
        : code === "send" ? "Unable to request an email right now. Try again later."
        : "Could not complete this request. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = emailKind === "signup"
        ? await auth.auth.resend({ type: "signup", email: email.trim(),
          options: { emailRedirectTo: callbackUrl(location.origin) } })
        : await auth.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: callbackUrl(location.origin),
        });
      if (result.error) throw new Error(result.error.status === 429 ? "rate" : "send");
      setNotice("If this address is eligible, another email will arrive shortly.");
    } catch (cause) {
      setError(cause instanceof Error && cause.message === "rate"
        ? "Too many email requests. Wait a while and try again."
        : "Unable to request an email right now. Try again later.");
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    setError("");
    try {
      const result = await auth.auth.signOut({ scope: "local" });
      if (result.error) throw result.error;
    } catch {
      setError("Could not sign out. Try again.");
      setBusy(false);
      return;
    }
    sessionStorage.removeItem(recoveryMarker);
    setBusy(false);
    setUser(null);
    switchMode("sign-in");
  }

  return <main className="account-layout">
    <section className="account-intro">
      <a className="account-brand" href="/account" aria-label="One Concept account home">
        <img src="/one-concept-icon.png" width="56" height="56" alt="One Concept icon" />
        <span>One Concept<small>by Coding Moves</small></span>
      </a>
      <h1>One account for learning on your phone and the web.</h1>
      <p>Sign in here with the same email and password you use in the One Concept app. Review workspace access is granted separately by the owner.</p>
      <a href="/" className="account-secondary-link">Invited reviewer? Open the review workspace</a>
    </section>
    <section className="account-panel" aria-label="Account access">
      {error && <p className="account-error" role="alert">{error}</p>}
      {notice && <p className="account-notice" role="status">{notice}</p>}
      {user && mode !== "reset" ? <>
        <h2>You're signed in</h2>
        <p>Your One Concept account is ready on this device.</p>
        <p className="account-email">{user.email}</p>
        <p>Open the One Concept app to continue learning. Your account is the same on both platforms.</p>
        <button type="button" disabled={busy} onClick={() => void signOut()}>Sign out of this browser</button>
      </> : mode === "check-email" ? <>
        <h2>Check your email</h2>
        <p>Open the newest {emailKind === "signup" ? "confirmation" : "reset"} link on this device or another device. The link expires; request another if needed.</p>
        <button type="button" disabled={busy} onClick={() => void resend()}>{busy ? "Please wait…" : "Send another email"}</button>
        <button type="button" className="account-text-button" onClick={() => switchMode("sign-in")}>Back to sign in</button>
      </> : <form onSubmit={event => void submit(event)}>
        <h2>{mode === "sign-up" ? "Create an account" : mode === "forgot" ? "Recover your account" : mode === "reset" ? "Set a new password" : "Sign in"}</h2>
        <p>{mode === "reset" ? "Choose a new password for your verified account. After saving it, return to the One Concept app." : "Use your One Concept email address."}</p>
        {mode !== "reset" && <label>Email address<input type="email" autoComplete="email" required value={email} onChange={event => setEmail(event.target.value)} /></label>}
        {(mode === "sign-up" || mode === "reset") && <p>Use at least {minimumPasswordLength} characters. Your account may require additional character types.</p>}
        {mode !== "forgot" && <label>{mode === "reset" ? "New password" : "Password"}<input type={showPassword ? "text" : "password"} autoComplete={mode === "sign-in" ? "current-password" : "new-password"} required value={password} onChange={event => { setPassword(event.target.value); setError(""); }} /></label>}
        {(mode === "sign-up" || mode === "reset") && <label>Confirm password<input type={showPassword ? "text" : "password"} autoComplete="new-password" required value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(""); }} /></label>}
        {mode !== "forgot" && <button type="button" className="account-text-button password-visibility" aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? "Hide passwords" : "Show passwords"}</button>}
        {mode === "reset" && needsMfa && <>
          <p>This account has an enrolled authenticator. Supabase requires its current code to change the password.</p>
          {factors.length > 1 && <label>Authenticator<select value={factor} onChange={event => setFactor(event.target.value)}>
            {factors.map(item => <option key={item.id} value={item.id}>{item.friendly_name || "Authenticator"}</option>)}
          </select></label>}
          <label>Current six-digit code<input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required value={code} onChange={event => setCode(event.target.value)} /></label>
        </>}
        <button type="submit" disabled={busy}>{busy ? "Please wait…" : mode === "sign-up" ? "Create account" : mode === "forgot" ? "Send reset email" : mode === "reset" ? "Update password" : "Sign in"}</button>
        {mode !== "reset" && <div className="account-switch">
          {mode !== "sign-in" && <button type="button" onClick={() => switchMode("sign-in")}>Sign in</button>}
          {mode !== "sign-up" && <button type="button" onClick={() => switchMode("sign-up")}>Create an account</button>}
          {mode !== "forgot" && <button type="button" onClick={() => switchMode("forgot")}>Forgot password?</button>}
        </div>}
      </form>}
    </section>
  </main>;
}

const root = createRoot(document.getElementById("root")!);
const incoming = new URL(location.href);
const link = emailReturn(incoming);
const callback = incoming.pathname === accountCallbackPath;
if (callback || incoming.hash || incoming.search) history.replaceState(null, "", "/account");

async function start() {
  try {
    const config = readConfig(import.meta.env);
    const auth = createClient(config.supabaseUrl, config.key, {
      auth: { detectSessionInUrl: false, flowType: "implicit", storageKey: "one-concept-public-account" },
    });
    let initial: Initial = { user: null, mode: "sign-in", notice: "", error: "" };
    if (link.kind === "error" || (callback && link.kind === "none")) {
      initial.error = "This email link is invalid or has expired. Request a new one.";
    } else if (link.kind === "session" || link.kind === "code") {
      const result = link.kind === "session"
        ? await auth.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken })
        : await auth.auth.exchangeCodeForSession(link.code);
      const verified = result.error || !result.data.session ? null : await auth.auth.getUser();
      if (!verified || verified.error || !verified.data.user) {
        initial.error = "This email link is invalid or has expired. Request a new one.";
      } else {
        initial.user = verified.data.user;
        initial.mode = link.type === "recovery" ? "reset" : "sign-in";
        initial.notice = link.type === "recovery" ? "" : "Email link verified. Your account is ready.";
        if (link.type === "recovery") sessionStorage.setItem(recoveryMarker, verified.data.user.id);
        else sessionStorage.removeItem(recoveryMarker);
      }
    } else {
      try {
        const existing = await auth.auth.getSession();
        if (existing.data.session) {
          const verified = await auth.auth.getUser();
          if (!verified.error && verified.data.user) {
            initial.user = verified.data.user;
            if (sessionStorage.getItem(recoveryMarker) === verified.data.user.id) initial.mode = "reset";
          }
        }
      } catch {
        initial.error = "Could not check your session. Check your connection and try again.";
      }
    }
    root.render(<Account auth={auth} initial={initial} />);
  } catch {
    root.render(<main className="account-unavailable"><h1>Account page unavailable</h1><p>Public account settings are incomplete. Please try again later or use the One Concept app.</p></main>);
  }
}
void start();
