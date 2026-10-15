/** Candidate Railway-compatible JSON routes. No production client uses these yet. */

export type ApiConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  allowedOrigins: readonly string[];
  contentLowWatermark?: number;
  contentReservePerTopic?: number;
  contentActiveDays?: number;
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

async function rpc(name: 'edge_api_health' | 'edge_api_topics' | 'edge_api_concept' | 'edge_api_set_interaction' | 'edge_api_notifications' | 'edge_api_set_notifications' | 'edge_api_push_token' | 'edge_api_stats' | 'edge_api_history' | 'edge_api_saved' | 'edge_api_subtopic_progress' | 'edge_api_mark_subtopics_seen' | 'edge_api_daily' | 'edge_api_complete_daily' | 'edge_api_achievements' | 'edge_api_achievements_seen' | 'edge_api_complete_review' | 'edge_api_state' | 'edge_api_set_topics', args: Record<string, unknown>, config: ApiConfig, fetcher: Fetcher): Promise<unknown> {
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

function subtopicIds(body: JsonObject): string[] {
  if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 100
      || !body.ids.every(value => typeof value === 'string' && UUID.test(value))) {
    throw new ClientBodyError(422, 'Invalid subtopic completion IDs');
  }
  return body.ids as string[];
}

function achievementCodes(body: JsonObject): string[] {
  if (!Array.isArray(body.codes) || body.codes.length < 1 || body.codes.length > 100
      || !body.codes.every(value => typeof value === 'string')) {
    throw new ClientBodyError(422, 'Invalid achievement codes');
  }
  return body.codes as string[];
}

function topicSlugs(body: JsonObject): string[] {
  const slugs = body.topics === undefined ? [] : body.topics;
  if (!Array.isArray(slugs) || slugs.length > 50
      || !slugs.every(value => typeof value === 'string')) {
    throw new ClientBodyError(422, 'Invalid followed topics');
  }
  return slugs as string[];
}

function pageLimit(query: URLSearchParams): number {
  const raw = query.get('limit');
  if (raw === null) return 50;
  if (!/^\d+$/.test(raw)) throw new ClientBodyError(422, 'Invalid page limit');
  const limit = Number(raw);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ClientBodyError(422, 'Invalid page limit');
  }
  return limit;
}

function queryBoolean(query: URLSearchParams, name: string): boolean {
  const raw = query.get(name)?.toLowerCase();
  if (raw === undefined || ['false', '0', 'off', 'no'].includes(raw)) return false;
  if (['true', '1', 'on', 'yes'].includes(raw)) return true;
  throw new ClientBodyError(422, `Invalid ${name} query value`);
}

async function signedAvatarUrl(ref: unknown, userId: string, config: ApiConfig, fetcher: Fetcher): Promise<string | null> {
  if (typeof ref !== 'string' || !new RegExp(`^avatars/${userId}/[a-f0-9]{32}\\.jpg$`).test(ref)) return null;
  try {
    const result = await fetcher(`${config.supabaseUrl}/storage/v1/object/sign/profile-avatars/${ref}`, {
      method: 'POST',
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ expiresIn: 120 }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
    if (!result.ok) return null;
    const value: { signedURL?: unknown } = await result.json();
    const expected = `/object/sign/profile-avatars/avatars/${userId}/`;
    return typeof value.signedURL === 'string' && value.signedURL.startsWith(expected)
      ? `${config.supabaseUrl}/storage/v1${value.signedURL}` : null;
  } catch {
    return null;
  }
}

function historyCursor(query: URLSearchParams): string | null {
  const raw = query.get('cursor');
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ClientBodyError(422, 'Invalid history cursor');
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new ClientBodyError(422, 'Invalid history cursor');
  }
  return raw;
}

function savedCursor(query: URLSearchParams): { before: string | null; conceptId: string | null } {
  const raw = query.get('cursor');
  if (raw === null) return { before: null, conceptId: null };
  if (raw.length > 200) throw new ClientBodyError(422, 'Saved cursor is too long');
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error('Invalid base64url');
    const bytes = Uint8Array.from(atob(raw.replaceAll('-', '+').replaceAll('_', '/')
      + '='.repeat((4 - raw.length % 4) % 4)), character => character.charCodeAt(0));
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(value) || value.length !== 2
        || typeof value[0] !== 'string' || typeof value[1] !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value[0])
        || Number.isNaN(Date.parse(value[0])) || !UUID.test(value[1])) {
      throw new Error('Invalid cursor fields');
    }
    return { before: value[0], conceptId: value[1] };
  } catch {
    throw new ClientBodyError(400, 'Invalid saved cursor');
  }
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
  const low = config.contentLowWatermark ?? 10;
  const reserve = config.contentReservePerTopic ?? 60;
  const activeDays = config.contentActiveDays ?? 90;
  if (![low, reserve, activeDays].every(Number.isInteger)
      || low < 0 || low > 30 || reserve < 1 || reserve > 365
      || activeDays < 1 || activeDays > 365) {
    throw new Error('Invalid content supply settings');
  }

  return async request => {
    const cors = corsHeaders(request.headers.get('origin'), config.allowedOrigins);
    if (!cors) return httpError(403, 'Origin not allowed', new Headers());
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const requestUrl = new URL(request.url);
    const path = routePath(requestUrl.pathname);
    if (path === null) return httpError(404, 'Not Found', cors);
    const concept = /^\/v1\/concepts\/([^/]+?)(?:\/(like|save))?$/.exec(path);
    const reviewComplete = /^\/v1\/reviews\/([^/]+)\/complete$/.exec(path);
    const notifications = path === '/v1/me/notifications';
    const pushToken = path === '/v1/me/push-token';
    const stats = path === '/v1/me/stats';
    const state = path === '/v1/me/state';
    const followedTopics = path === '/v1/me/topics';
    const history = path === '/v1/me/history';
    const saved = path === '/v1/me/saved';
    const subtopicProgress = path === '/v1/me/subtopics/progress';
    const subtopicSeen = path === '/v1/me/subtopics/completions/seen';
    const achievements = path === '/v1/me/achievements';
    const achievementsSeen = path === '/v1/me/achievements/seen';
    const daily = path === '/v1/daily';
    const dailyComplete = path === '/v1/daily/complete';
    if (path !== '/health' && path !== '/v1/topics' && !notifications && !pushToken && !stats && !state && !followedTopics && !history && !saved && !subtopicProgress && !subtopicSeen && !achievements && !achievementsSeen && !daily && !dailyComplete && concept === null && reviewComplete === null) {
      return httpError(404, 'Not Found', cors);
    }
    const validMethod = concept?.[2]
      ? request.method === 'PUT' || request.method === 'DELETE'
      : notifications
        ? request.method === 'GET' || request.method === 'PUT'
        : followedTopics
          ? request.method === 'PUT'
        : pushToken
          ? request.method === 'POST' || request.method === 'DELETE'
          : subtopicSeen || achievementsSeen || dailyComplete || reviewComplete !== null
            ? request.method === 'POST'
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
      if (daily) {
        const selected = await rpc('edge_api_daily', {
          p_user_id: userId, p_low: low, p_reserve: reserve,
          p_active_days: activeDays, p_today: null,
        }, config, fetcher) as JsonObject;
        return response(selected, selected.reason ? 409 : 200, cors);
      }
      if (dailyComplete) {
        const completed = await rpc('edge_api_complete_daily', {
          p_user_id: userId, p_today: null,
        }, config, fetcher);
        return completed === null
          ? httpError(404, 'No concept has been assigned recently. Fetch /v1/daily first.', cors)
          : response(completed, 200, cors);
      }
      if (reviewComplete) {
        if (!UUID.test(reviewComplete[1])) return httpError(422, 'Invalid review ID', cors);
        const completed = await rpc('edge_api_complete_review', {
          p_user_id: userId, p_review_id: reviewComplete[1], p_today: null,
        }, config, fetcher);
        return completed === null
          ? httpError(409, 'Review is unavailable or its completion window has ended', cors)
          : response(completed, 200, cors);
      }
      if (stats) {
        return response(await rpc('edge_api_stats', { p_user_id: userId }, config, fetcher), 200, cors);
      }
      if (state) {
        const data = await rpc('edge_api_state', {
          p_user_id: userId,
          p_compact: queryBoolean(requestUrl.searchParams, 'compact'),
          p_reviews: queryBoolean(requestUrl.searchParams, 'reviews'),
          p_low: low, p_reserve: reserve, p_active_days: activeDays, p_today: null,
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        data.avatar_url = await signedAvatarUrl(data.avatar_ref, userId, config, fetcher);
        return response(data, 200, cors);
      }
      if (followedTopics) {
        const body = await readJson(request);
        const data = await rpc('edge_api_set_topics', {
          p_user_id: userId, p_slugs: topicSlugs(body!),
          p_compact: queryBoolean(requestUrl.searchParams, 'compact'), p_today: null,
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (data.error === 'unknown_topics' && Array.isArray(data.topics)) {
          const labels = data.topics.map(value => `'${String(value)}'`).join(', ');
          return httpError(400, `Unknown topics: [${labels}]`, cors);
        }
        data.avatar_url = await signedAvatarUrl(data.avatar_ref, userId, config, fetcher);
        return response(data, 200, cors);
      }
      if (history) {
        return response(await rpc('edge_api_history', {
          p_user_id: userId, p_before: historyCursor(requestUrl.searchParams),
          p_limit: pageLimit(requestUrl.searchParams),
        }, config, fetcher), 200, cors);
      }
      if (saved) {
        const cursor = savedCursor(requestUrl.searchParams);
        return response(await rpc('edge_api_saved', {
          p_user_id: userId, p_before: cursor.before, p_concept_id: cursor.conceptId,
          p_limit: pageLimit(requestUrl.searchParams),
        }, config, fetcher), 200, cors);
      }
      if (subtopicProgress) {
        return response(await rpc('edge_api_subtopic_progress', { p_user_id: userId }, config, fetcher), 200, cors);
      }
      if (subtopicSeen) {
        const body = await readJson(request);
        await rpc('edge_api_mark_subtopics_seen', {
          p_user_id: userId, p_ids: subtopicIds(body!),
        }, config, fetcher);
        return noContent(cors);
      }
      if (achievements) {
        const data = await rpc('edge_api_achievements', { p_user_id: userId }, config, fetcher);
        return data === null ? unavailable(cors) : response(data, 200, cors);
      }
      if (achievementsSeen) {
        const body = await readJson(request);
        await rpc('edge_api_achievements_seen', {
          p_user_id: userId, p_codes: achievementCodes(body!),
        }, config, fetcher);
        return noContent(cors);
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
