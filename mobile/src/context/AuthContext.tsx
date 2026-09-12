import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { API_BASE_URL, ApiError, setConnectivity, setTokenProvider } from '../api/client';
import { readCachedSession, supabase } from '../lib/supabase';
import { clearAccountCaches } from '../services/accountCaches';
import { restoreAuthSession } from '../services/authSession';
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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The API client asks for a token per request; Supabase refreshes it in the
    // background, so this always hands back a currently valid one.
    setTokenProvider(async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        if (isAuthRetryableFetchError(error)) {
          setConnectivity(false);
          throw new ApiError(0, 'Could not refresh session', error);
        }
        throw new ApiError(401, 'Session unavailable');
      }
      return data.session?.access_token ?? null;
    });

    return restoreAuthSession(
      supabase.auth,
      readCachedSession,
      setSession,
      () => setLoading(false),
      () => { clearAccountCaches().catch(() => {}); },
    );
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!userId) return;
    // Best-effort; a token refresh must not block cached browsing.
    registerForReminders().catch(() => {});
    syncTimezone().catch(() => {});
  }, [userId]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
    });
    if (error) throw error;
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
    if (error) throw error;
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
