/** Candidate Railway-compatible JSON routes. No production client uses these yet. */

export type ApiConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  allowedOrigins: readonly string[];
};

type Fetcher = typeof fetch;
type AuthUser = { id?: unknown };
type JsonObject = Record<string, unknown>;

const METHODS = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
const HEADERS = 'authorization, apikey, content-type, x-client-info';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HH_MM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const MAX_JSON_BYTES = 4096;

class ClientBodyError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

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

async function rpc(name: 'edge_api_health' | 'edge_api_topics' | 'edge_api_concept' | 'edge_api_set_interaction' | 'edge_api_notifications' | 'edge_api_set_notifications' | 'edge_api_push_token', args: Record<string, unknown>, config: ApiConfig, fetcher: Fetcher): Promise<unknown> {
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

async function readJson(request: Request, optional = false): Promise<JsonObject | null> {
  const length = request.headers.get('content-length');
  if (length !== null && (Number.isNaN(Number(length)) || Number(length) > MAX_JSON_BYTES)) {
    throw new ClientBodyError(413, 'Request body is too large');
  }
  const reader = request.body?.getReader();
  if (!reader) {
    if (optional) return null;
    throw new ClientBodyError(422, 'Invalid request body');
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      throw new ClientBodyError(413, 'Request body is too large');
    }
    chunks.push(value);
  }
  if (size === 0 && optional) return null;
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value as JsonObject;
  } catch { /* invalid JSON */ }
  throw new ClientBodyError(422, 'Invalid request body');
}

function notificationInput(body: JsonObject): { enabled: boolean; weekly: boolean | null; times: string[] } {
  const times = body.reminder_times;
  if (typeof body.enabled !== 'boolean'
      || !Array.isArray(times) || times.length < 1 || times.length > 3
      || !times.every(value => typeof value === 'string' && HH_MM.test(value))
      || (body.weekly_quiz_enabled !== undefined && body.weekly_quiz_enabled !== null
          && typeof body.weekly_quiz_enabled !== 'boolean')) {
    throw new ClientBodyError(422, 'Invalid notification preferences');
  }
  return {
    enabled: body.enabled,
    weekly: typeof body.weekly_quiz_enabled === 'boolean' ? body.weekly_quiz_enabled : null,
    times: [...new Set(times as string[])].sort(),
  };
}

function pushInput(body: JsonObject): { token: string; platform: string | null } {
  const token = body.expo_push_token;
  const platform = body.platform;
  if (typeof token !== 'string' || token.length < 10 || token.length > 200
      || (platform !== undefined && platform !== null && platform !== 'ios' && platform !== 'android')) {
    throw new ClientBodyError(422, 'Invalid push token');
  }
  return { token, platform: typeof platform === 'string' ? platform : null };
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
    const notifications = path === '/v1/me/notifications';
    const pushToken = path === '/v1/me/push-token';
    if (path !== '/health' && path !== '/v1/topics' && !notifications && !pushToken && concept === null) {
      return httpError(404, 'Not Found', cors);
    }
    const validMethod = concept?.[2]
      ? request.method === 'PUT' || request.method === 'DELETE'
      : notifications
        ? request.method === 'GET' || request.method === 'PUT'
        : pushToken
          ? request.method === 'POST' || request.method === 'DELETE'
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
      if (notifications) {
        const data = request.method === 'GET'
          ? await rpc('edge_api_notifications', { p_user_id: userId }, config, fetcher)
          : await (async () => {
            const body = await readJson(request);
            const input = notificationInput(body!);
            return rpc('edge_api_set_notifications', {
              p_user_id: userId, p_enabled: input.enabled,
              p_weekly: input.weekly, p_times: input.times,
            }, config, fetcher);
          })();
        return data === null ? httpError(404, 'No preferences yet', cors) : response(data, 200, cors);
      }
      if (pushToken) {
        const body = await readJson(request, request.method === 'DELETE');
        const input = body === null ? { token: null, platform: null } : pushInput(body);
        await rpc('edge_api_push_token', {
          p_user_id: userId, p_token: input.token,
          p_platform: input.platform, p_register: request.method === 'POST',
        }, config, fetcher);
        return noContent(cors);
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
    } catch (failure) {
      if (failure instanceof ClientBodyError) return httpError(failure.status, failure.message, cors);
      // Do not echo provider errors or sensitive query details to callers.
      return unavailable(cors);
    }
  };
}
