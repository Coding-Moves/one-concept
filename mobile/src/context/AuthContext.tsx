import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { API_BASE_URL, setTokenProvider } from '../api/client';
import { supabase } from '../lib/supabase';
import { clearAccountCaches } from '../services/accountCaches';
import {
  deregisterForReminders,
  registerForReminders,
  syncTimezone,
} from '../services/notifications';

export interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Supabase errors are readable, but a few are worth rewording for humans. */
function describe(error: { message: string; status?: number }): string {
  const message = error.message.toLowerCase();
  if (message.includes('invalid login credentials')) {
    return 'That email and password combination did not match an account.';
  }
  if (message.includes('already registered') || message.includes('already been registered')) {
    return 'An account with that email already exists. Try signing in instead.';
  }
  if (message.includes('password should be')) {
    return 'Passwords need to be at least 6 characters.';
  }
  if (message.includes('failed to fetch') || message.includes('network')) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return error.message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The API client asks for a token per request; Supabase refreshes it in the
    // background, so this always hands back a currently valid one.
    setTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    let active = true;

    // The app-level spinner is gated on `loading`, so it MUST always resolve —
    // even offline or if secure storage is unreadable. A timeout is the
    // backstop against getSession() hanging; the catch handles a rejection.
    // Either way we fall through to the signed-out UI rather than an infinite
    // spinner (issue #133).
    const failsafe = setTimeout(() => {
      if (active) setLoading(false);
    }, 8000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setSession(data.session);
        setLoading(false);
        // Best-effort: reminders are a bonus, never a blocker for signing in.
        if (data.session) {
          registerForReminders().catch(() => {});
          syncTimezone().catch(() => {});
        } else {
          // Signed out at startup: account caches have no business existing.
          // Covers sessions that vanished without a SIGNED_OUT ever firing
          // (cleared or corrupted auth storage across a restart).
          clearAccountCaches().catch(() => {});
        }
      })
      .catch(() => {
        // Couldn't read the session (e.g. corrupted/locked secure store):
        // treat as signed out instead of hanging on the spinner.
        if (active) {
          setSession(null);
          setLoading(false);
        }
      })
      .finally(() => clearTimeout(failsafe));

    const { data: subscription } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      if (event === 'SIGNED_IN' && next) {
        registerForReminders().catch(() => {});
        syncTimezone().catch(() => {});
      }
      if (event === 'SIGNED_OUT') {
        // Account data must not outlive the account on a shared device. The
        // event covers every sign-out path — the button, an expired refresh
        // token, a revoked session — not just our own signOut() call.
        clearAccountCaches().catch(() => {});
      }
    });

    return () => {
      active = false;
      clearTimeout(failsafe);
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(describe(error));
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) throw new Error(describe(error));
    // With email confirmation switched on, sign-up returns a user but no session.
    return { needsConfirmation: !data.session };
  }, []);

  const resetPassword = useCallback(async (email: string) => {
    // Sends a recovery link to /reset-password (a backend web page), where the
    // user sets a new password. Supabase returns success whether or not the
    // email is registered, so the UI must stay deliberately neutral — never
    // confirm an account exists.
    //
    // Only pass redirectTo when we have an absolute base URL. An empty
    // API_BASE_URL would make it the relative '/reset-password', which is not a
    // valid redirect — better to fall back to the project's Site URL.
    const options = API_BASE_URL
      ? { redirectTo: `${API_BASE_URL}/reset-password` }
      : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), options);
    if (error) throw new Error(describe(error));
  }, []);

  const signOut = useCallback(async () => {
    // Deregister the push token first — it is an authenticated call, so it
    // must happen while the session is still valid. Best-effort: reminders
    // stopping matters less than the sign-out itself succeeding.
    await deregisterForReminders().catch(() => {});
    // Global sign-out revokes the session server-side, but it needs the
    // network — and a user handing over a shared device must end up signed
    // out either way. Fall back to a local sign-out, which clears the device
    // session and fires SIGNED_OUT (and the cache wipe) without a connection.
    const { error } = await supabase.auth.signOut();
    if (error) await supabase.auth.signOut({ scope: 'local' });
  }, []);

  // Memoised so consumers only re-render when something they read actually
  // changes. signIn/signUp/signOut are stable (useCallback), so the object is
  // rebuilt only on a real loading or session change — not on every parent render.
  const value = useMemo<AuthContextValue>(
    () => ({
      loading,
      session,
      email: session?.user?.email ?? null,
      signIn,
      signUp,
      resetPassword,
      signOut,
    }),
    [loading, session, signIn, signUp, resetPassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}
