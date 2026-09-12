import { isAuthRetryableFetchError, type Session, type SupabaseClient } from '@supabase/supabase-js';

type Auth = Pick<SupabaseClient['auth'], 'getSession' | 'onAuthStateChange'>;

/** Cached identity unlocks local browsing only; API calls still ask Supabase for a token. */
export function restoreAuthSession(
  auth: Auth,
  readCached: () => Promise<Session | null>,
  onSession: (session: Session | null) => void,
  onReady: () => void,
  onSignedOut: () => void,
): () => void {
  let active = true;
  let authoritative = false;
  const ready = () => {
    if (active) onReady();
  };
  // Storage failure must not leave startup spinning indefinitely.
  const failsafe = setTimeout(ready, 8000);
  const accept = (session: Session | null) => {
    if (!active) return;
    authoritative = true;
    onSession(session);
    if (!session) onSignedOut();
    clearTimeout(failsafe);
    ready();
  };

  const { data } = auth.onAuthStateChange((event, session) => {
    // Supabase also emits INITIAL_SESSION(null) on a retryable refresh error.
    // Only getSession's error-aware result can confirm an absent initial session.
    if (event !== 'INITIAL_SESSION') accept(session);
  });

  const cached = readCached().catch(() => null);
  void cached.then((session) => {
    if (!active || authoritative) return;
    if (session) onSession(session);
    ready();
  });

  void auth.getSession().then(async ({ data: { session }, error }) => {
    if (!active || authoritative) return;
    if (error && isAuthRetryableFetchError(error)) {
      await cached;
      ready();
      return;
    }
    accept(session);
  }).catch(() => {
    // Unexpected storage/network failures are not evidence of a sign-out.
    ready();
  });

  return () => {
    active = false;
    clearTimeout(failsafe);
    data.subscription.unsubscribe();
  };
}
