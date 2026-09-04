import type { Session } from '@supabase/supabase-js';
import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { setTokenProvider } from '../api/client';
import { supabase } from '../lib/supabase';
import { clearAccountCaches } from '../services/accountCaches';
import { registerForReminders, syncTimezone } from '../services/notifications';

export interface AuthContextValue {
  loading: boolean;
  session: Session | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
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
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setLoading(false);
      // Best-effort: reminders are a bonus, never a blocker for signing in.
      if (data.session) {
        registerForReminders().catch(() => {});
        syncTimezone().catch(() => {});
      }
    });

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

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const value: AuthContextValue = {
    loading,
    session,
    email: session?.user?.email ?? null,
    signIn,
    signUp,
    signOut,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside an AuthProvider');
  return value;
}
