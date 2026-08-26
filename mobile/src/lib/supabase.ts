import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { sessionStorage } from './secureStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(url && anonKey);

/**
 * Supabase client, used only for authentication.
 *
 * All application data goes through the FastAPI backend — the app never reads
 * or writes tables directly, so this client's job is to obtain and refresh the
 * access token that the backend verifies.
 */
export const supabase = createClient(url, anonKey, {
  auth: {
    storage: sessionStorage,
    autoRefreshToken: true,
    persistSession: true,
    // No OAuth redirect handling on native; sessions come from the password flow.
    detectSessionInUrl: false,
  },
});
