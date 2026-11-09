/**
 * Supabase Edge Functions serve HTML responses as text/plain. Redirect browser
 * entry points to the hosted pages so confirmation and recovery can execute.
 */
// The verified first-party origin is the default for mobile email callbacks.
// PUBLIC_SITE_URL can still override this for another deployment environment.
export const DEFAULT_PUBLIC_SITE = 'https://review.oneconcept.codingmoves.com';

export function publicPage(path: string, method: string, requestUrl: URL, cors: Headers,
  siteOrigin: string): Response | null {
  if (!['/confirmed', '/reset-password', '/privacy'].includes(path)) return null;
  const headers = new Headers(cors);
  headers.set('cache-control', 'no-store');
  headers.set('referrer-policy', 'no-referrer');
  headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  if (method !== 'GET') {
    headers.set('content-type', 'application/json; charset=utf-8');
    headers.set('allow', 'GET');
    return new Response(JSON.stringify({ detail: 'Method Not Allowed' }), { status: 405, headers });
  }

  const target = new URL(path === '/privacy' ? '/privacy' : '/account/callback', siteOrigin);
  if (path !== '/privacy') target.search = requestUrl.search;
  // A code-only return does not carry a fragment with Supabase's recovery type.
  // Preserve that intent when the original email targeted the reset endpoint.
  if (path === '/reset-password' && target.searchParams.has('code') &&
      !target.searchParams.get('type')) target.searchParams.set('type', 'recovery');
  // Do not set a fragment on Location. Browsers inherit the incoming fragment
  // (which can hold Supabase auth tokens) without sending it to this function.
  headers.set('location', target.toString());
  return new Response(null, { status: 302, headers });
}
