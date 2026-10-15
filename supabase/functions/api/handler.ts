/** Candidate Railway-compatible JSON routes. No production client uses these yet. */

export type ApiConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  allowedOrigins: readonly string[];
};

type Fetcher = typeof fetch;
type AuthUser = { id?: unknown };

const METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const HEADERS = 'authorization, apikey, content-type, x-client-info';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function routePath(pathname: string): string | null {
  for (const prefix of ['/functions/v1/api', '/api']) {
    if (pathname === prefix) return '/';
    if (pathname.startsWith(`${prefix}/`)) return pathname.slice(prefix.length);
  }
  return null;
}

function response(body: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { status, headers });
}

function httpError(status: number, detail: string, cors: Headers, authenticate = false): Response {
  const result = response({ detail }, status, cors);
  if (authenticate) result.headers.set('www-authenticate', 'Bearer');
  return result;
}

function unavailable(cors: Headers): Response {
  const incident = crypto.randomUUID().replaceAll('-', '');
  const result = response({ error: { code: 'service_unavailable', incident_id: incident } }, 503, cors);
  result.headers.set('retry-after', '30');
  result.headers.set('x-incident-id', incident);
  return result;
}

function corsHeaders(origin: string | null, allowed: readonly string[]): Headers | null {
  if (origin !== null && !allowed.includes(origin)) return null;
  const headers = new Headers({ vary: 'Origin' });
  if (origin !== null) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-credentials', 'true');
    headers.set('access-control-allow-methods', METHODS);
    headers.set('access-control-allow-headers', HEADERS);
    headers.set('access-control-expose-headers', 'Retry-After');
  }
  return headers;
}

function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization');
  const match = header?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

async function authenticatedUser(token: string, config: ApiConfig, fetcher: Fetcher): Promise<string | null> {
  const result = await fetcher(`${config.supabaseUrl}/auth/v1/user`, {
    method: 'GET',
    headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (result.status === 401 || result.status === 403) return null;
  if (!result.ok) throw new Error(`Auth unavailable: ${result.status}`);
  const user: AuthUser = await result.json();
  return typeof user.id === 'string' && UUID.test(user.id) ? user.id : null;
}

async function rpc(name: 'edge_api_health' | 'edge_api_topics' | 'edge_api_concept' | 'edge_api_set_interaction', args: Record<string, unknown>, config: ApiConfig, fetcher: Fetcher): Promise<unknown> {
  const result = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      authorization: `Bearer ${config.serviceRoleKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(5000),
    redirect: 'error',
  });
  if (!result.ok) throw new Error(`Database unavailable: ${result.status}`);
  return result.json();
}

function noContent(cors: Headers): Response {
  const headers = new Headers(cors);
  headers.set('cache-control', 'no-store');
  return new Response(null, { status: 204, headers });
}

export function createHandler(config: ApiConfig, fetcher: Fetcher = fetch): (request: Request) => Promise<Response> {
  const url = new URL(config.supabaseUrl);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('SUPABASE_URL must use HTTPS');
  }
  if (!config.anonKey || !config.serviceRoleKey) throw new Error('Supabase keys are required');
  if (config.allowedOrigins.some(origin => {
    const parsed = new URL(origin);
    return parsed.origin !== origin || (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1');
  })) throw new Error('Allowed origins must be exact HTTPS origins or local development origins');

  return async request => {
    const cors = corsHeaders(request.headers.get('origin'), config.allowedOrigins);
    if (!cors) return httpError(403, 'Origin not allowed', new Headers());
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const path = routePath(new URL(request.url).pathname);
    if (path === null) return httpError(404, 'Not Found', cors);
    const concept = /^\/v1\/concepts\/([^/]+?)(?:\/(like|save))?$/.exec(path);
    if (path !== '/health' && path !== '/v1/topics' && concept === null) {
      return httpError(404, 'Not Found', cors);
    }
    const validMethod = concept?.[2]
      ? request.method === 'PUT' || request.method === 'DELETE'
      : request.method === 'GET';
    if (!validMethod) return httpError(405, 'Method Not Allowed', cors);

    try {
      if (path === '/health') {
        return response(await rpc('edge_api_health', {}, config, fetcher), 200, cors);
      }
      const token = bearerToken(request);
      if (!token) return httpError(401, 'Missing bearer token', cors, true);
      const userId = await authenticatedUser(token, config, fetcher);
      if (!userId) return httpError(401, 'Invalid or expired token', cors, true);
      if (path === '/v1/topics') {
        return response(await rpc('edge_api_topics', { p_user_id: userId }, config, fetcher), 200, cors);
      }
      if (concept) {
        let slug: string;
        try {
          slug = decodeURIComponent(concept[1]);
        } catch {
          return httpError(404, 'Not Found', cors);
        }
        if (slug.includes('/') || slug.length > 200) return httpError(404, 'Not Found', cors);
        if (!concept[2]) {
          const detail = await rpc('edge_api_concept', { p_user_id: userId, p_slug: slug }, config, fetcher);
          return detail === null ? httpError(404, 'Concept not found', cors) : response(detail, 200, cors);
        }
        const found = await rpc('edge_api_set_interaction', {
          p_user_id: userId,
          p_slug: slug,
          p_kind: concept[2],
          p_on: request.method === 'PUT',
        }, config, fetcher);
        return found === false
          ? httpError(404, `No concept with slug '${slug}'`, cors)
          : noContent(cors);
      }
      return httpError(404, 'Not Found', cors);
    } catch {
      // Do not echo provider errors or sensitive query details to callers.
      return unavailable(cors);
    }
  };
}
