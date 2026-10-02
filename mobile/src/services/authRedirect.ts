export type AuthLandingPath = 'confirmed' | 'reset-password';

/**
 * Builds a browser landing URL on the configured API origin.
 *
 * Email verification happens at Supabase first. `emailRedirectTo` then sends a
 * verified user here, so it must use the same deployed API origin as the app
 * rather than relying on a potentially stale Supabase Site URL. Returning
 * undefined preserves Supabase's Site URL fallback during an incomplete local
 * configuration; release validation prevents that state from being published.
 */
export function authLandingUrl(path: AuthLandingPath, baseUrl: string): string | undefined {
  if (!baseUrl) return undefined;

  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname
      || url.username || url.password || url.search || url.hash) return undefined;

    url.pathname = `${url.pathname.replace(/\/+$/, '')}/${path}`;
    return url.toString();
  } catch {
    return undefined;
  }
}
