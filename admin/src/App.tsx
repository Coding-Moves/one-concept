import { useCallback, useEffect, useRef, useState } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { Api, ApiError } from "./api";
import { Login, Mfa } from "./Auth";
import { Notice, message } from "./ui";
import type { Me } from "./types";
import { Settings } from "./Settings";
import { Queue } from "./Queue";
import { Review } from "./Review";
import { Team } from "./Team";
import { Generation } from "./Generation";
export interface Route {
  view: string;
  id?: string;
  kind?: string;
}
function route(): Route {
  const p = new URLSearchParams(location.search);
  return {
    view: p.get("view") || "queue",
    id: p.get("id") || undefined,
    kind: p.get("kind") || undefined,
  };
}
export function App({
  auth,
  api,
  environment,
  passwordSetup: initialSetup = false,
  initialError = "",
}: {
  auth: SupabaseClient;
  api: Api;
  environment: string;
  passwordSetup?: boolean;
  initialError?: string;
}) {
  const [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [me, setMe] = useState<Me | null>(null),
    [error, setError] = useState(initialError),
    [setup, setSetup] = useState(initialSetup),
    [current, setCurrent] = useState<Route>(route),
    [theme, setTheme] = useState(
      () => localStorage.getItem("review-theme") || "light",
    ),
    [epoch, setEpoch] = useState(0);
  const account = useRef<string | null>(null),
    dirty = useRef(false),
    sessionRef = useRef<Session | null>(null),
    url = useRef(location.href);
  const reloadMe = useCallback(async () => {
    try {
      const value = await api.request<Me>("/me");
      setMe(value);
      setError("");
    } catch (e) {
      if (e instanceof ApiError && e.status === 499) return;
      // Keep unsent work mounted through temporary outages. Denials are
      // handled by onDenied, which clears private state and fences requests.
      if (!(e instanceof ApiError && (e.status === 0 || e.status >= 500)))
        setMe(null);
      setError(message(e));
    }
  }, [api]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("review-theme", theme);
  }, [theme]);
  useEffect(() => {
    const {
      data: { subscription },
    } = auth.auth.onAuthStateChange((event, next) => {
      const id = next?.user.id || null;
      const changed = id !== account.current || event === "SIGNED_OUT";
      account.current = id;
      sessionRef.current = next;
      api.setToken(next?.access_token || null, changed);
      setSession(next);
      setReady(true);
      if (changed) {
        setMe(null);
        if (event !== "INITIAL_SESSION" && event !== "SIGNED_OUT") setError("");
        dirty.current = false;
        setEpoch((n) => n + 1);
      }
      if (event === "PASSWORD_RECOVERY") setSetup(true);
    });
    api.onDenied = (status) => {
      api.setToken(null, true);
      setMe(null);
      dirty.current = false;
      setEpoch((n) => n + 1);
      setError(
        status === 401
          ? "Your session expired. Sign in again."
          : "Access changed. Refresh account access or contact your administrator.",
      );
      if (status === 401) {
        setSession(null);
        void auth.auth.signOut({ scope: "local" });
      }
    };
    return () => {
      subscription.unsubscribe();
      api.onDenied = () => {};
    };
  }, [auth, api]);
  useEffect(() => {
    if (session && !setup) void reloadMe();
  }, [session?.access_token, setup, reloadMe]);
  useEffect(() => {
    const check = () => {
      if (sessionRef.current && document.visibilityState === "visible")
        void reloadMe();
    };
    const timer = setInterval(check, 60000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [reloadMe]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (dirty.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    const pop = () => {
      if (
        dirty.current &&
        !confirm("Leave this page and discard unsent feedback?")
      ) {
        history.pushState(null, "", url.current);
        return;
      }
      dirty.current = false;
      url.current = location.href;
      setCurrent(route());
    };
    window.addEventListener("beforeunload", before);
    window.addEventListener("popstate", pop);
    return () => {
      window.removeEventListener("beforeunload", before);
      window.removeEventListener("popstate", pop);
    };
  }, []);
  function navigate(next: Route) {
    if (
      dirty.current &&
      !confirm("Leave this page and discard unsent feedback?")
    )
      return;
    dirty.current = false;
    const p = new URLSearchParams({
      view: next.view,
      ...(next.id ? { id: next.id } : {}),
      ...(next.kind ? { kind: next.kind } : {}),
    });
    history.pushState(null, "", "/?" + p);
    url.current = location.href;
    setCurrent(next);
    window.scrollTo(0, 0);
  }
  async function signOut() {
    if (dirty.current && !confirm("Sign out and discard unsent feedback?"))
      return;
    setError("");
    api.setToken(null, true);
    sessionRef.current = null;
    setMe(null);
    setSession(null);
    dirty.current = false;
    setEpoch((n) => n + 1);
    const { error } = await auth.auth.signOut();
    if (error) {
      localStorage.removeItem("one-concept-review-auth");
      localStorage.removeItem("one-concept-review-auth-user");
      location.replace("/");
    }
  }
  if (!ready)
    return (
      <div className="startup" role="status">
        Opening One Concept Review…
      </div>
    );
  if (!session || setup)
    return (
      <>
        {error && <Notice error>{error}</Notice>}
        <Login
          key={epoch}
          auth={auth}
          passwordSetup={setup && !!session}
          onPasswordSet={() => {
            setSetup(false);
            navigate({ view: "queue" });
          }}
        />
      </>
    );
  const can = (cap: string) => !!me?.member.capabilities.includes(cap as never);
  const nav = [
    ["queue", "Review queue", "▤"],
    ["legacy", "Existing lessons", "▧"],
    ["approved", "Approved", "✓"],
    ["published", "Published", "↗"],
    ...(can("request_generation") && can("review")
      ? [["generation", "AI requests", "✧"]]
      : []),
    ...(can("manage_reviewers") ? [["team", "Reviewers", "♧"]] : []),
    ["settings", "Settings", "⚙"],
  ];
  const active = !!me?.member.approved_name && !me?.mfa_required;
  return (
    <div className="workspace">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">1</span>
          <div>
            One Concept<small>Review workspace</small>
          </div>
        </div>
        <p className="nav-label">WORKSPACE</p>
        <nav aria-label="Main navigation">
          {nav.map(([view, title, icon]) => (
            <button
              key={view}
              className={current.view === view ? "selected" : ""}
              onClick={() => navigate({ view })}
            >
              <span aria-hidden="true">{icon}</span>
              {title}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="environment">● {environment}</span>
          <p>
            Better lessons.
            <br />
            One thoughtful review at a time.
          </p>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <span>
            Editorial /{" "}
            <strong>
              {nav.find((x) => x[0] === current.view)?.[1] || "Lesson review"}
            </strong>
          </span>
          <div className="top-actions">
            <span className="environment compact-environment">
              ● {environment}
            </span>
            <button
              className="icon-button"
              aria-label={
                theme === "light" ? "Use dark theme" : "Use light theme"
              }
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              {theme === "light" ? "☾" : "☀"}
            </button>
            <span className="user-name">
              {me?.member.approved_name || session.user.email}
            </span>
            <button onClick={() => void signOut()}>Sign out</button>
          </div>
        </header>
        <main id="main" key={epoch}>
          {error && me && (
            <Notice error>
              Account access could not be refreshed. Your unsent work is
              preserved. {error}{" "}
              <button onClick={() => void reloadMe()}>
                Retry account check
              </button>
            </Notice>
          )}
          {error && !me ? (
            <div className="card narrow">
              <h1>Workspace unavailable</h1>
              <Notice error>{error}</Notice>
              <button
                onClick={() => {
                  api.setToken(session.access_token);
                  void reloadMe();
                }}
              >
                Refresh account access
              </button>
            </div>
          ) : !me ? (
            <Notice>Checking your account…</Notice>
          ) : current.view === "settings" || !me.member.approved_name ? (
            <Settings
              api={api}
              me={me}
              reloadMe={reloadMe}
              environment={environment}
            />
          ) : me.mfa_required ? (
            <Mfa auth={auth} onVerified={() => void reloadMe()} />
          ) : active ? (
            <>
              {current.view === "team" && can("manage_reviewers") ? (
                <Team api={api} me={me} />
              ) : current.view === "generation" &&
                can("request_generation") &&
                can("review") ? (
                <Generation api={api} navigate={navigate} />
              ) : current.view === "review" && current.id && can("review") ? (
                <Review
                  key={current.kind + current.id}
                  api={api}
                  me={me}
                  id={current.id}
                  kind={current.kind || "revisions"}
                  navigate={navigate}
                  setDirty={(value) => {
                    dirty.current = value;
                  }}
                />
              ) : can("review") ? (
                <Queue
                  key={current.view}
                  api={api}
                  me={me}
                  view={current.view}
                  navigate={navigate}
                />
              ) : (
                <Notice>
                  Your account has no review permission. Contact the workspace
                  owner.
                </Notice>
              )}
            </>
          ) : null}
        </main>
      </div>
    </div>
  );
}
