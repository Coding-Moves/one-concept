import 'react-native-url-polyfill/auto';
import { createClient, type Session } from '@supabase/supabase-js';
import { sessionStorage } from './secureStorage';
import { fetchWithTimeout } from '../api/fetchWithTimeout';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);
// Match Supabase's existing default key, so installed sessions need no migration.
const storageKey = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;

export async function readCachedSession(): Promise<Session | null> {
  const raw = await sessionStorage.getItem(storageKey);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw) as Session;
    return session?.access_token && session.refresh_token && session.user?.id
      ? session : null;
  } catch {
    return null;
  }
}

/**
 * Supabase client, used only for authentication.
 *
 * All application data goes through the FastAPI backend — the app never reads
 * or writes tables directly, so this client's job is to obtain and refresh the
 * access token that the backend verifies.
 */
export const supabase = createClient(url, anonKey, {
  global: { fetch: fetchWithTimeout },
  auth: {
    storageKey,
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect handling on native; sessions come from the password flow.
    detectSessionInUrl: false,
  },
});
