/** Candidate Railway-compatible JSON routes. No production client uses these yet. */

export type ApiConfig = {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  allowedOrigins: readonly string[];
  contentLowWatermark?: number;
  contentReservePerTopic?: number;
  contentActiveDays?: number;
  editorialEnabled?: boolean;
  minPoolPerTopic?: number;
  contentReviewBacklogLimit?: number;
  generationEnabled?: boolean;
  futureRefillEnabled?: boolean;
  providerConfigured?: boolean;
  legacyEnrichmentEnabled?: boolean;
  geminiModel?: string;
  editorialEmailEnabled?: boolean;
  editorialEmailDashboardUrl?: string;
  editorialEmailSenderConfigured?: boolean;
  editorialEmailTestRecipientsConfigured?: boolean;
  editorialEmailDailyCap?: number;
  environment?: string;
  ownerTelemetryEnabled?: boolean;
  editorialAutoCorrectionEnabled?: boolean;
  generationDailyCallCap?: number;
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

class UpstreamError extends Error {
  readonly component: 'auth' | 'database';
  readonly status: number;
  constructor(component: 'auth' | 'database', status: number) {
    super('Upstream unavailable');
    this.component = component;
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

function editorialResponse(body: unknown, status: number, cors: Headers, authenticate = false): Response {
  const result = response(body, status, cors);
  result.headers.set('vary', 'Authorization, Origin');
  result.headers.set('x-content-type-options', 'nosniff');
  result.headers.set('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
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
  let result: Response;
  try {
    result = await fetcher(`${config.supabaseUrl}/auth/v1/user`, {
      method: 'GET',
      headers: { apikey: config.anonKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
  } catch { throw new UpstreamError('auth', 0); }
  if (result.status === 401 || result.status === 403) return null;
  if (!result.ok) throw new UpstreamError('auth', result.status);
  const user: AuthUser = await result.json();
  return typeof user.id === 'string' && UUID.test(user.id) ? user.id : null;
}

function editorialClaims(token: string, verifiedUserId: string): {
  sessionId: string; aal: string; mfaVerifiedAt: number | null
} | null {
  // Supabase Auth has already verified this exact bearer token. Read only the
  // session and AAL claims, then recheck session ownership in PostgreSQL.
  const parts = token.split('.');
  if (parts.length !== 3 || parts[1].length > 8192 || !/^[A-Za-z0-9_-]+$/.test(parts[1])) return null;
  try {
    const encoded = parts[1].replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
      char => char.charCodeAt(0));
    const payload: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
    const claims = payload as JsonObject;
    if (claims.sub !== verifiedUserId || typeof claims.session_id !== 'string'
        || !UUID.test(claims.session_id)) return null;
    let mfaVerifiedAt: number | null = null;
    if (Array.isArray(claims.amr)) for (const entry of claims.amr) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
      const item = entry as JsonObject;
      if (item.method === 'totp' && typeof item.timestamp === 'number'
          && Number.isSafeInteger(item.timestamp)) {
        mfaVerifiedAt = Math.max(mfaVerifiedAt ?? item.timestamp, item.timestamp);
      }
    }
    return { sessionId: claims.session_id, aal: claims.aal === 'aal2' ? 'aal2' : 'aal1', mfaVerifiedAt };
  } catch { return null; }
}

async function rpc(name: 'edge_api_health' | 'edge_api_topics' | 'edge_api_concept' | 'edge_api_set_interaction' | 'edge_api_notifications' | 'edge_api_set_notifications' | 'edge_api_push_token' | 'edge_api_stats' | 'edge_api_history' | 'edge_api_saved' | 'edge_api_subtopic_progress' | 'edge_api_analytics' | 'edge_api_mark_subtopics_seen' | 'edge_api_daily' | 'edge_api_complete_daily' | 'edge_api_achievements' | 'edge_api_achievements_seen' | 'edge_api_complete_review' | 'edge_api_state' | 'edge_api_set_topics' | 'edge_api_patch_profile' | 'edge_api_sharing_get' | 'edge_api_sharing_put' | 'edge_api_public_profile' | 'edge_api_connection_settings_get' | 'edge_api_connection_settings_put' | 'edge_api_connections' | 'edge_api_connection_status' | 'edge_api_connection_request' | 'edge_api_connection_block_token' | 'edge_api_connection_action' | 'edge_api_connection_unblock' | 'edge_api_relationship_status' | 'edge_api_relationship_connect' | 'edge_api_relationship_remove' | 'edge_api_relationship_block' | 'edge_api_relationships' | 'edge_api_weekly_quiz' | 'edge_api_submit_weekly_quiz' | 'edge_api_subtopic_quiz' | 'edge_api_submit_subtopic_quiz' | 'edge_api_subtopic_quiz_attempts' | 'edge_api_editorial_me' | 'edge_api_editorial_reviewers' | 'edge_api_editorial_taxonomy' | 'edge_api_editorial_activity' | 'edge_api_editorial_legacy_entries' | 'edge_api_editorial_queue' | 'edge_api_editorial_revision_history' | 'edge_api_editorial_generation_jobs' | 'edge_api_editorial_generation_job' | 'edge_api_editorial_generation_supply' | 'edge_api_editorial_legacy_eligibility' | 'edge_api_editorial_concept_timeline' | 'edge_api_editorial_legacy_batches' | 'edge_api_editorial_notification_policy' | 'edge_api_editorial_notifications_overview' | 'edge_api_editorial_notification_retry' | 'edge_api_editorial_owner_operations' | 'edge_api_editorial_owner_overview' | 'edge_api_editorial_owner_reviewers' | 'edge_api_editorial_request_profile' | 'edge_api_editorial_notification_timezone' | 'edge_api_editorial_authenticator' | 'edge_api_editorial_approve_profile', args: Record<string, unknown>, config: ApiConfig, fetcher: Fetcher): Promise<unknown> {
  let result: Response;
  try {
    result = await fetcher(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
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
  } catch { throw new UpstreamError('database', 0); }
  if (!result.ok) throw new UpstreamError('database', result.status);
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

function quizAnswers(body: JsonObject, minCount: number, maxCount: number): { question_id: string; selected_index: number }[] {
  if (!Array.isArray(body.answers) || body.answers.length < minCount || body.answers.length > maxCount) {
    throw new ClientBodyError(422, 'Invalid quiz answers');
  }
  const answers: { question_id: string; selected_index: number }[] = [];
  for (const value of body.answers) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new ClientBodyError(422, 'Invalid quiz answers');
    }
    const answer = value as JsonObject;
    if (typeof answer.question_id !== 'string'
        || answer.question_id.length < 1 || answer.question_id.length > 200
        || typeof answer.selected_index !== 'number'
        || !Number.isInteger(answer.selected_index)
        || answer.selected_index < 0 || answer.selected_index > 3) {
      throw new ClientBodyError(422, 'Invalid quiz answers');
    }
    answers.push({ question_id: answer.question_id, selected_index: answer.selected_index });
  }
  if (new Set(answers.map(answer => answer.question_id)).size !== answers.length) {
    throw new ClientBodyError(422, 'Submit one answer for each quiz question');
  }
  return answers;
}

function topicSlugs(body: JsonObject): string[] {
  const slugs = body.topics === undefined ? [] : body.topics;
  if (!Array.isArray(slugs) || slugs.length > 50
      || !slugs.every(value => typeof value === 'string')) {
    throw new ClientBodyError(422, 'Invalid followed topics');
  }
  return slugs as string[];
}

function profileInput(body: JsonObject): {
  displayName: string | null; hasBio: boolean; bio: string | null;
  preset: string | null; timezone: string | null; initializeTimezone: boolean;
} {
  const rawName = body.display_name;
  let displayName: string | null = null;
  if (rawName !== undefined && rawName !== null) {
    if (typeof rawName !== 'string' || [...rawName].length > 60) {
      throw new ClientBodyError(422, 'Invalid display name');
    }
    displayName = rawName.normalize('NFC').trim();
    if (!displayName || [...displayName].length > 60 || /\p{C}/u.test(displayName)) {
      throw new ClientBodyError(422, 'Invalid display name');
    }
  }
  const hasBio = Object.prototype.hasOwnProperty.call(body, 'bio');
  const rawBio = body.bio;
  if (hasBio && rawBio !== null && (typeof rawBio !== 'string' || [...rawBio].length > 160)) {
    throw new ClientBodyError(422, 'Invalid bio');
  }
  const bio = typeof rawBio === 'string' ? rawBio.trim().split(/\s+/u).join(' ') || null : null;
  const rawPreset = body.avatar_preset;
  if (rawPreset !== undefined && rawPreset !== null
      && (typeof rawPreset !== 'string'
          || !['aurora', 'comet', 'forest', 'ocean', 'sunset', 'violet'].includes(rawPreset))) {
    throw new ClientBodyError(422, 'Unknown avatar preset');
  }
  const rawTimezone = body.timezone;
  if (rawTimezone !== undefined && rawTimezone !== null
      && (typeof rawTimezone !== 'string' || [...rawTimezone].length > 64)) {
    throw new ClientBodyError(422, 'Invalid timezone');
  }
  const initializeTimezone = body.initialize_timezone === undefined ? false : body.initialize_timezone;
  if (typeof initializeTimezone !== 'boolean') {
    throw new ClientBodyError(422, 'Invalid timezone initialization');
  }
  return {
    displayName, hasBio, bio, preset: typeof rawPreset === 'string' ? rawPreset : null,
    timezone: typeof rawTimezone === 'string' ? rawTimezone : null, initializeTimezone,
  };
}

function editorialProfileInput(body: JsonObject): { version: number; name: string } {
  if (Object.keys(body).some(key => key !== 'expected_version' && key !== 'registered_name')
      || typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version)
      || body.expected_version < 1 || body.expected_version > 2147483647
      || typeof body.registered_name !== 'string'
      || [...body.registered_name].length > 160) {
    throw new ClientBodyError(422, 'Invalid editorial profile');
  }
  const name = body.registered_name.normalize('NFC').trim().split(/\s+/u).join(' ');
  if ([...name].length < 2 || [...name].length > 80 || /\p{C}/u.test(name)) {
    throw new ClientBodyError(422, 'Invalid editorial profile');
  }
  return { version: body.expected_version, name };
}

function editorialTimezoneInput(body: JsonObject): { version: number; timezone: string } {
  if (Object.keys(body).some(key => key !== 'expected_version' && key !== 'timezone')
      || typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version)
      || body.expected_version < 1 || body.expected_version > 2147483647
      || typeof body.timezone !== 'string'
      || body.timezone.length < 1 || body.timezone.length > 80) {
    throw new ClientBodyError(422, 'Invalid editorial notification timezone');
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: body.timezone }); }
  catch { throw new ClientBodyError(422, 'Invalid editorial notification timezone'); }
  return { version: body.expected_version, timezone: body.timezone };
}

function editorialAuthenticatorInput(body: JsonObject): { version: number; required: boolean } {
  if (Object.keys(body).some(key => key !== 'expected_version' && key !== 'require_mfa')
      || typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version)
      || body.expected_version < 1 || body.expected_version > 2147483647
      || typeof body.require_mfa !== 'boolean') {
    throw new ClientBodyError(422, 'Invalid editorial authenticator setting');
  }
  return { version: body.expected_version, required: body.require_mfa };
}

function editorialVersionInput(body: JsonObject): number {
  if (Object.keys(body).some(key => key !== 'expected_version')
      || typeof body.expected_version !== 'number' || !Number.isInteger(body.expected_version)
      || body.expected_version < 1 || body.expected_version > 2147483647) {
    throw new ClientBodyError(422, 'Invalid editorial account version');
  }
  return body.expected_version;
}

function editorialPolicyInput(body: JsonObject): {
  version: number; deadline: number; reminder: number; maxReminders: number;
} {
  const allowed = ['expected_version', 'deadline_hours', 'reminder_hours', 'max_reminders'];
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ClientBodyError(422, 'Invalid editorial notification policy');
  }
  const fields = [body.expected_version, body.deadline_hours, body.reminder_hours, body.max_reminders];
  if (!fields.every(value => typeof value === 'number' && Number.isInteger(value))
      || (body.expected_version as number) < 1 || (body.expected_version as number) > 2147483647
      || (body.deadline_hours as number) < 1 || (body.deadline_hours as number) > 720
      || (body.reminder_hours as number) < 1 || (body.reminder_hours as number) > 168
      || (body.max_reminders as number) < 0 || (body.max_reminders as number) > 10) {
    throw new ClientBodyError(422, 'Invalid editorial notification policy');
  }
  return { version: body.expected_version as number, deadline: body.deadline_hours as number,
    reminder: body.reminder_hours as number, maxReminders: body.max_reminders as number };
}

function editorialEmailSetupStatus(config: ApiConfig): string {
  if (!config.editorialEnabled || !config.editorialEmailEnabled) return 'disabled';
  const raw = config.editorialEmailDashboardUrl ?? '';
  let dashboard: URL;
  try { dashboard = new URL(raw); }
  catch { return 'dashboard_setup_required'; }
  if (dashboard.protocol !== 'https:' || !dashboard.hostname || dashboard.username
      || dashboard.password || dashboard.search || dashboard.hash
      || (dashboard.pathname !== '/' && dashboard.pathname !== '')
      || !config.allowedOrigins.includes(raw.replace(/\/+$/, ''))) {
    return 'dashboard_setup_required';
  }
  if (!config.editorialEmailSenderConfigured) return 'sender_setup_required';
  if (!(config.environment ?? 'development').toLowerCase().startsWith('prod')
      && !config.editorialEmailTestRecipientsConfigured) return 'test_recipients_required';
  return 'ready';
}

function sharingInput(body: JsonObject): Record<string, unknown> {
  const allowed = ['enabled', 'show_name', 'show_avatar', 'show_bio',
    'show_streak', 'show_learning', 'achievement_codes', 'version'];
  if (Object.keys(body).some(key => !allowed.includes(key))) {
    throw new ClientBodyError(422, 'Invalid sharing settings');
  }
  const flags = allowed.slice(0, 6);
  if (flags.some(key => body[key] !== undefined && typeof body[key] !== 'boolean')
      || typeof body.version !== 'number' || !Number.isInteger(body.version) || body.version < 0
      || (body.achievement_codes !== undefined
          && (!Array.isArray(body.achievement_codes)
              || body.achievement_codes.length > 32
              || !body.achievement_codes.every(code => typeof code === 'string')))) {
    throw new ClientBodyError(422, 'Invalid sharing settings');
  }
  return {
    p_enabled: body.enabled ?? false,
    p_show_name: body.show_name ?? false,
    p_show_avatar: body.show_avatar ?? false,
    p_show_bio: body.show_bio ?? false,
    p_show_streak: body.show_streak ?? false,
    p_show_learning: body.show_learning ?? false,
    p_codes: body.achievement_codes ?? [],
    p_version: body.version,
  };
}

function connectionSettingsInput(body: JsonObject): { p_accepting: boolean; p_version: number } {
  if (Object.keys(body).some(key => key !== 'accepting_requests' && key !== 'version')
      || typeof body.accepting_requests !== 'boolean'
      || typeof body.version !== 'number' || !Number.isInteger(body.version)
      || body.version < 0) {
    throw new ClientBodyError(422, 'Invalid connection settings');
  }
  return { p_accepting: body.accepting_requests, p_version: body.version };
}

function connectionPageInput(query: URLSearchParams): {
  kind: string; cursor: string | null; limit: number;
} {
  const kind = query.get('kind') ?? 'accepted';
  const cursor = query.get('cursor');
  const rawLimit = query.get('limit') ?? '25';
  if (!['accepted', 'incoming', 'outgoing', 'blocked'].includes(kind)
      || (cursor !== null && !UUID.test(cursor))
      || !/^\d+$/.test(rawLimit)) {
    throw new ClientBodyError(422, 'Invalid connection page');
  }
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new ClientBodyError(422, 'Invalid connection page');
  }
  return { kind, cursor, limit };
}

function relationshipPageInput(query: URLSearchParams): {
  created: string | null; id: string | null; limit: number;
} {
  const rawLimit = query.get('limit') ?? '25';
  if (!/^\d+$/.test(rawLimit)) throw new ClientBodyError(422, 'Invalid relationship page');
  const limit = Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) {
    throw new ClientBodyError(422, 'Invalid relationship page');
  }
  const cursor = query.get('cursor');
  if (cursor === null) return { created: null, id: null, limit };
  const split = cursor.lastIndexOf(':');
  const created = cursor.slice(0, split);
  const id = cursor.slice(split + 1);
  const timestamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(created);
  const year = Number(timestamp?.[1]);
  const month = Number(timestamp?.[2]);
  const day = Number(timestamp?.[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (split < 1 || !UUID.test(id)
      || !timestamp || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
      || Number(timestamp[4]) > 23 || Number(timestamp[5]) > 59 || Number(timestamp[6]) > 59
      || (timestamp[7] !== undefined && (Number(timestamp[7]) > 23 || Number(timestamp[8]) > 59))
      || Number.isNaN(Date.parse(created))) {
    throw new ClientBodyError(422, 'Invalid cursor');
  }
  return { created, id, limit };
}

function editorialTimelineInput(query: URLSearchParams): {
  afterAt: string | null; afterKey: string | null; limit: number;
} {
  const rawLimit = query.get('limit') ?? '25';
  const limit = Number(rawLimit);
  if (!/^\d+$/.test(rawLimit) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new ClientBodyError(422, 'Invalid timeline page');
  }
  const cursor = query.get('cursor');
  if (cursor === null) return { afterAt: null, afterKey: null, limit };
  if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw new ClientBodyError(422, 'Invalid timeline cursor');
  }
  try {
    const encoded = cursor.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')),
      char => char.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!Array.isArray(parsed) || parsed.length !== 2
        || typeof parsed[0] !== 'string' || typeof parsed[1] !== 'string') throw new Error();
    const [afterAt, afterKey] = parsed as [string, string];
    const stamp = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(afterAt);
    const year = Number(stamp?.[1]);
    const month = Number(stamp?.[2]);
    const day = Number(stamp?.[3]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (!stamp || year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]
        || Number(stamp[4]) > 23 || Number(stamp[5]) > 59 || Number(stamp[6]) > 59
        || (stamp[7] !== undefined && (Number(stamp[7]) > 23 || Number(stamp[8]) > 59))
        || Number.isNaN(Date.parse(afterAt))
        || !/^[rw]:/.test(afterKey) || !UUID.test(afterKey.slice(2))) throw new Error();
    return { afterAt, afterKey, limit };
  } catch { throw new ClientBodyError(422, 'Invalid timeline cursor'); }
}

function connectionActionInput(body: JsonObject): string {
  if (Object.keys(body).length !== 1 || typeof body.action !== 'string'
      || !['accept', 'decline', 'cancel', 'remove', 'block'].includes(body.action)) {
    throw new ClientBodyError(422, 'Invalid connection action');
  }
  return body.action;
}

function sharingResponse(body: unknown, status: number, cors: Headers): Response {
  const result = response(body, status, cors);
  result.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  result.headers.set('referrer-policy', 'no-referrer');
  result.headers.set('x-content-type-options', 'nosniff');
  return result;
}

function privateNoContent(cors: Headers): Response {
  const result = noContent(cors);
  result.headers.set('x-robots-tag', 'noindex, nofollow, noarchive');
  result.headers.set('referrer-policy', 'no-referrer');
  result.headers.set('x-content-type-options', 'nosniff');
  return result;
}

function publicProfileFields(value: unknown): JsonObject | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as JsonObject;
  if (!Array.isArray(raw.achievements) || !raw.achievements.every(item =>
    typeof item === 'object' && item !== null && !Array.isArray(item)
      && typeof item.name === 'string' && typeof item.description === 'string')) return null;
  const profile: JsonObject = { achievements: raw.achievements.map(item => ({
    name: item.name, description: item.description,
  })) };
  for (const key of ['display_name', 'bio'] as const) {
    if (typeof raw[key] === 'string') profile[key] = raw[key];
  }
  if (typeof raw.avatar_ref === 'string'
      && /^preset:(aurora|comet|forest|ocean|sunset|violet)$/.test(raw.avatar_ref)) {
    profile.avatar_ref = raw.avatar_ref;
  }
  for (const key of ['current_streak', 'longest_streak', 'concepts_learned'] as const) {
    if (typeof raw[key] === 'number' && Number.isSafeInteger(raw[key])) profile[key] = raw[key];
  }
  return profile;
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

async function signedAvatarUrl(ref: unknown, userId: string, config: ApiConfig, fetcher: Fetcher, timeoutMs = 5000): Promise<string | null> {
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
      signal: AbortSignal.timeout(Math.max(1, timeoutMs)),
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

async function deleteOldAvatar(ref: unknown, userId: string, config: ApiConfig, fetcher: Fetcher): Promise<void> {
  if (typeof ref !== 'string' || !new RegExp(`^avatars/${userId}/[a-f0-9]{32}\\.jpg$`).test(ref)) return;
  try {
    await fetcher(`${config.supabaseUrl}/storage/v1/object/profile-avatars`, {
      method: 'DELETE',
      headers: {
        apikey: config.serviceRoleKey,
        authorization: `Bearer ${config.serviceRoleKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefixes: [ref] }),
      signal: AbortSignal.timeout(5000),
      redirect: 'error',
    });
  } catch { /* A failed old-object cleanup must not undo the saved profile. */ }
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

function ownerDateInput(query: URLSearchParams, name: string): string | null {
  const value = query.get(name);
  if (value === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ClientBodyError(422, 'Invalid owner date');
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ClientBodyError(422, 'Invalid owner date');
  }
  return value;
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
  if (!Number.isInteger(config.editorialEmailDailyCap ?? 40)
      || (config.editorialEmailDailyCap ?? 40) < 0
      || (config.editorialEmailDailyCap ?? 40) > 500) {
    throw new Error('Invalid editorial email daily cap');
  }
  if (!Number.isInteger(config.generationDailyCallCap ?? 200)
      || (config.generationDailyCallCap ?? 200) < 0) {
    throw new Error('Invalid generation daily call cap');
  }

  return async request => {
    const cors = corsHeaders(request.headers.get('origin'), config.allowedOrigins);
    if (!cors) return httpError(403, 'Origin not allowed', new Headers());
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const requestUrl = new URL(request.url);
    const path = routePath(requestUrl.pathname);
    if (path === null) return httpError(404, 'Not Found', cors);
    const concept = /^\/v1\/concepts\/([^/]+?)(?:\/(like|save))?$/.exec(path);
    const publicProfile = /^\/v1\/public-profiles\/([^/]+)$/.exec(path);
    const connectionStatus = /^\/v1\/me\/connections\/with\/([^/]+)$/.exec(path);
    const connectionBlock = /^\/v1\/me\/connections\/with\/([^/]+)\/block$/.exec(path);
    const connectionAction = /^\/v1\/me\/connections\/([^/]+)\/actions$/.exec(path);
    const connectionUnblock = /^\/v1\/me\/connections\/blocks\/([^/]+)$/.exec(path);
    const relationshipStatus = /^\/v1\/me\/relationships\/with\/([^/]+)$/.exec(path);
    const relationshipBlock = /^\/v1\/me\/relationships\/with\/([^/]+)\/block$/.exec(path);
    const relationshipRemove = /^\/v1\/me\/relationships\/([^/]+)$/.exec(path);
    const relationshipBlockById = /^\/v1\/me\/relationships\/([^/]+)\/block$/.exec(path);
    const reviewComplete = /^\/v1\/reviews\/([^/]+)\/complete$/.exec(path);
    const weeklyAttempt = /^\/v1\/quizzes\/weekly\/([^/]+)\/attempts$/.exec(path);
    const subtopicQuiz = /^\/v1\/quizzes\/subtopics\/([^/]+)$/.exec(path);
    const subtopicAttempt = /^\/v1\/quizzes\/subtopics\/([^/]+)\/attempts$/.exec(path);
    const notifications = path === '/v1/me/notifications';
    const pushToken = path === '/v1/me/push-token';
    const stats = path === '/v1/me/stats';
    const analytics = path === '/v1/me/analytics';
    const sharing = path === '/v1/me/profile-sharing';
    const connectionSettings = path === '/v1/me/connections/settings';
    const connectionList = path === '/v1/me/connections';
    const relationshipList = path === '/v1/me/relationships';
    const weeklyQuiz = path === '/v1/quizzes/weekly';
    const editorialMe = path === '/v1/editorial/me';
    const editorialReviewers = path === '/v1/editorial/reviewers';
    const editorialTaxonomy = path === '/v1/editorial/taxonomy';
    const editorialActivity = path === '/v1/editorial/activity';
    const editorialQueue = path === '/v1/editorial/queue';
    const editorialHistory = /^\/v1\/editorial\/concepts\/([^/]+)\/revisions$/.exec(path);
    const editorialTimeline = /^\/v1\/editorial\/concepts\/([^/]+)\/timeline$/.exec(path);
    const editorialJobs = path === '/v1/editorial/generation-jobs';
    const editorialJob = /^\/v1\/editorial\/generation-jobs\/([^/]+)$/.exec(path);
    const editorialSupply = /^\/v1\/editorial\/generation-supply\/([^/]+)$/.exec(path);
    const editorialLegacyEligibility = /^\/v1\/editorial\/legacy-enrichment-eligibility\/([^/]+)$/.exec(path);
    const editorialLegacyBatches = path === '/v1/editorial/legacy-enrichment-batches';
    const editorialLegacyEntries = /^\/v1\/editorial\/legacy-enrichment-batches\/([^/]+)\/entries$/.exec(path);
    const editorialNotifications = path === '/v1/editorial/notifications';
    const editorialNotificationPolicy = path === '/v1/editorial/notifications/policy';
    const editorialNotificationRetry = /^\/v1\/editorial\/notifications\/([^/]+)\/retry$/.exec(path);
    const editorialOwnerOperations = path === '/v1/editorial/owner/operations';
    const editorialOwnerOverview = path === '/v1/editorial/owner/overview';
    const editorialOwnerReviewers = path === '/v1/editorial/owner/reviewers';
    const editorialProfile = path === '/v1/editorial/me/profile';
    const editorialTimezone = path === '/v1/editorial/me/notification-timezone';
    const editorialAuthenticator = path === '/v1/editorial/me/authenticator';
    const editorialApproveProfile = /^\/v1\/editorial\/reviewers\/([^/]+)\/approve-profile$/.exec(path);
    const editorial = editorialMe || editorialReviewers || editorialTaxonomy || editorialActivity || editorialQueue
      || editorialHistory !== null || editorialTimeline !== null
      || editorialJobs || editorialJob !== null || editorialSupply !== null
      || editorialLegacyEligibility !== null || editorialLegacyBatches
      || editorialNotifications || editorialNotificationPolicy || editorialNotificationRetry !== null
      || editorialOwnerOperations || editorialOwnerOverview || editorialOwnerReviewers
      || editorialLegacyEntries !== null || editorialProfile
      || editorialTimezone || editorialAuthenticator || editorialApproveProfile !== null;
    const state = path === '/v1/me/state';
    const profile = path === '/v1/me';
    const followedTopics = path === '/v1/me/topics';
    const history = path === '/v1/me/history';
    const saved = path === '/v1/me/saved';
    const subtopicProgress = path === '/v1/me/subtopics/progress';
    const subtopicSeen = path === '/v1/me/subtopics/completions/seen';
    const achievements = path === '/v1/me/achievements';
    const achievementsSeen = path === '/v1/me/achievements/seen';
    const daily = path === '/v1/daily';
    const dailyComplete = path === '/v1/daily/complete';
    if (path !== '/health' && path !== '/v1/topics' && !notifications && !pushToken && !stats && !analytics && !sharing && !connectionSettings && !connectionList && !relationshipList && !weeklyQuiz && !editorial && weeklyAttempt === null && subtopicQuiz === null && subtopicAttempt === null && !state && !profile && !followedTopics && !history && !saved && !subtopicProgress && !subtopicSeen && !achievements && !achievementsSeen && !daily && !dailyComplete && concept === null && publicProfile === null && connectionStatus === null && connectionBlock === null && connectionAction === null && connectionUnblock === null && relationshipStatus === null && relationshipBlock === null && relationshipRemove === null && relationshipBlockById === null && reviewComplete === null) {
      return httpError(404, 'Not Found', cors);
    }
    const validMethod = concept?.[2]
      ? request.method === 'PUT' || request.method === 'DELETE'
      : notifications || sharing || connectionSettings
        ? request.method === 'GET' || request.method === 'PUT'
        : connectionStatus
          ? request.method === 'GET' || request.method === 'POST'
        : followedTopics
          ? request.method === 'PUT'
        : profile
          ? request.method === 'PATCH'
        : editorialProfile || editorialTimezone || editorialAuthenticator || editorialNotificationPolicy
          ? request.method === 'PATCH'
        : editorialApproveProfile || editorialNotificationRetry
          ? request.method === 'POST'
        : pushToken
          ? request.method === 'POST' || request.method === 'DELETE'
        : relationshipStatus
          ? request.method === 'GET' || request.method === 'POST'
        : relationshipRemove
          ? request.method === 'DELETE'
        : weeklyAttempt
          ? request.method === 'POST'
        : subtopicAttempt
          ? request.method === 'GET' || request.method === 'POST'
        : connectionUnblock
          ? request.method === 'DELETE'
          : subtopicSeen || achievementsSeen || dailyComplete || reviewComplete !== null || connectionBlock !== null || relationshipBlock !== null || relationshipBlockById !== null || connectionAction !== null
            ? request.method === 'POST'
          : request.method === 'GET';
    if (!validMethod) return httpError(405, 'Method Not Allowed', cors);

    try {
      if (path === '/health') {
        return response(await rpc('edge_api_health', {}, config, fetcher), 200, cors);
      }
      if (publicProfile) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(publicProfile[1])) {
          return sharingResponse({ detail: 'Profile unavailable' }, 404, cors);
        }
        const data = await rpc('edge_api_public_profile', {
          p_token: publicProfile[1],
        }, config, fetcher) as JsonObject | null;
        if (data === null) return sharingResponse({ detail: 'Profile unavailable' }, 404, cors);
        const visible = publicProfileFields(data.profile);
        if (visible === null) return unavailable(cors);
        if (typeof data.avatar_owner === 'string' && UUID.test(data.avatar_owner)) {
          const signed = await signedAvatarUrl(data.avatar_key, data.avatar_owner, config, fetcher);
          if (signed) visible.avatar_url = signed;
        }
        return sharingResponse(visible, 200, cors);
      }
      const token = bearerToken(request);
      if (!token) return editorial
        ? editorialResponse({ detail: 'Missing bearer token' }, 401, cors, true)
        : httpError(401, 'Missing bearer token', cors, true);
      const userId = await authenticatedUser(token, config, fetcher);
      if (!userId) return editorial
        ? editorialResponse({ detail: 'Invalid or expired token' }, 401, cors, true)
        : httpError(401, 'Invalid or expired token', cors, true);
      if (editorial) {
        if (!config.editorialEnabled) return editorialResponse({ detail: 'Editorial access is disabled' }, 503, cors);
        const claims = editorialClaims(token, userId);
        if (!claims) return editorialResponse({ detail: 'A current Supabase session is required' }, 401, cors, true);
        const cursor = requestUrl.searchParams.get('cursor');
        const topicId = requestUrl.searchParams.get('topic_id');
        const rawLimit = requestUrl.searchParams.get('limit') ?? (editorialTaxonomy ? '100' : '25');
        const pageDetail = editorialTaxonomy ? 'Invalid taxonomy page'
          : editorialActivity ? 'Invalid activity page'
          : editorialQueue ? 'Invalid editorial queue'
          : editorialNotifications ? 'Invalid notification page'
          : editorialHistory ? 'Invalid revision page'
          : editorialTimeline ? 'Invalid timeline page'
          : editorialJobs ? 'Invalid generation job page' : 'Invalid reviewer page';
        const queueKind = requestUrl.searchParams.get('kind') ?? 'revisions';
        const queueStatus = requestUrl.searchParams.get('status');
        const queueAssignee = requestUrl.searchParams.get('assignee_id');
        const queueSubtopic = requestUrl.searchParams.get('subtopic_id');
        const queueUrgency = requestUrl.searchParams.get('urgency');
        const queueSearch = requestUrl.searchParams.get('search') ?? '';
        if ((editorialReviewers || editorialOwnerReviewers || editorialTaxonomy || editorialActivity || editorialQueue
          || editorialHistory || editorialJobs || editorialNotifications)
            && ((cursor !== null && !UUID.test(cursor))
              || ((editorialActivity || editorialQueue || editorialJobs) && topicId !== null && !UUID.test(topicId))
              || !/^\d+$/.test(rawLimit) || Number(rawLimit) < 1
              || Number(rawLimit) > (editorialOwnerReviewers ? 50 : 100))) {
          return editorialResponse({ detail: pageDetail }, 422, cors);
        }
        if (editorialQueue && (
          !['revisions', 'legacy', 'published'].includes(queueKind)
          || (queueStatus !== null && !['generating', 'draft', 'validation_failed',
            'pending_review', 'changes_requested', 'approved', 'rejected', 'published', 'retired'].includes(queueStatus))
          || (queueAssignee !== null && !UUID.test(queueAssignee))
          || (queueSubtopic !== null && !UUID.test(queueSubtopic))
          || (queueUrgency !== null && !['overdue', 'scheduled', 'unscheduled'].includes(queueUrgency))
          || Array.from(queueSearch).length > 120)) {
          return editorialResponse({ detail: pageDetail }, 422, cors);
        }
        if (editorialQueue && queueKind !== 'revisions'
            && (queueStatus !== null || queueAssignee !== null || queueUrgency !== null)) {
          return editorialResponse({ detail: 'Status, assignee and urgency apply to revisions only' }, 422, cors);
        }
        if (editorialApproveProfile && !UUID.test(editorialApproveProfile[1])) {
          return editorialResponse({ detail: 'Invalid reviewer ID' }, 422, cors);
        }
        if (editorialLegacyEntries && !UUID.test(editorialLegacyEntries[1])) {
          return editorialResponse({ detail: 'Invalid batch ID' }, 422, cors);
        }
        if (editorialHistory && !UUID.test(editorialHistory[1])) {
          return editorialResponse({ detail: 'Invalid concept ID' }, 422, cors);
        }
        if (editorialTimeline && !UUID.test(editorialTimeline[1])) {
          return editorialResponse({ detail: 'Invalid concept ID' }, 422, cors);
        }
        let timelineInput: ReturnType<typeof editorialTimelineInput> | null = null;
        if (editorialTimeline) {
          try { timelineInput = editorialTimelineInput(requestUrl.searchParams); }
          catch (failure) {
            return editorialResponse({ detail: failure instanceof ClientBodyError
              ? failure.message : 'Invalid timeline cursor' }, 422, cors);
          }
        }
        if (editorialJob && !UUID.test(editorialJob[1])) {
          return editorialResponse({ detail: 'Invalid generation job ID' }, 422, cors);
        }
        if (editorialSupply && !UUID.test(editorialSupply[1])) {
          return editorialResponse({ detail: 'Invalid topic ID' }, 422, cors);
        }
        if (editorialLegacyEligibility && !UUID.test(editorialLegacyEligibility[1])) {
          return editorialResponse({ detail: 'Invalid topic ID' }, 422, cors);
        }
        if (editorialLegacyBatches && topicId !== null && !UUID.test(topicId)) {
          return editorialResponse({ detail: 'Invalid topic ID' }, 422, cors);
        }
        if (editorialNotificationRetry && !UUID.test(editorialNotificationRetry[1])) {
          return editorialResponse({ detail: 'Invalid delivery ID' }, 422, cors);
        }
        const jobStatus = requestUrl.searchParams.get('status');
        const jobConcept = requestUrl.searchParams.get('concept_id');
        if (editorialJobs && (
          (jobStatus !== null && !['pending', 'generating', 'failed',
            'ready_for_review', 'cancelled', 'superseded'].includes(jobStatus))
          || (jobConcept !== null && !UUID.test(jobConcept)))) {
          return editorialResponse({ detail: pageDetail }, 422, cors);
        }
        const profileInput = editorialProfile
          ? editorialProfileInput((await readJson(request))!) : null;
        const timezoneInput = editorialTimezone
          ? editorialTimezoneInput((await readJson(request))!) : null;
        const authenticatorInput = editorialAuthenticator
          ? editorialAuthenticatorInput((await readJson(request))!) : null;
        const approvalVersion = editorialApproveProfile
          ? editorialVersionInput((await readJson(request))!) : null;
        const policyInput = editorialNotificationPolicy
          ? editorialPolicyInput((await readJson(request))!) : null;
        const retryVersion = editorialNotificationRetry
          ? editorialVersionInput((await readJson(request))!) : null;
        const ownerDates = (editorialOwnerOverview || editorialOwnerReviewers) ? {
          start: ownerDateInput(requestUrl.searchParams, 'start'),
          end: ownerDateInput(requestUrl.searchParams, 'end'),
        } : null;
        const data = await rpc(editorialApproveProfile ? 'edge_api_editorial_approve_profile'
          : editorialNotificationPolicy ? 'edge_api_editorial_notification_policy'
          : editorialNotifications ? 'edge_api_editorial_notifications_overview'
          : editorialNotificationRetry ? 'edge_api_editorial_notification_retry'
          : editorialOwnerOperations ? 'edge_api_editorial_owner_operations'
          : editorialOwnerOverview ? 'edge_api_editorial_owner_overview'
          : editorialOwnerReviewers ? 'edge_api_editorial_owner_reviewers'
          : editorialAuthenticator ? 'edge_api_editorial_authenticator'
          : editorialTimezone ? 'edge_api_editorial_notification_timezone'
          : editorialProfile ? 'edge_api_editorial_request_profile'
          : editorialReviewers ? 'edge_api_editorial_reviewers'
          : editorialTaxonomy ? 'edge_api_editorial_taxonomy'
          : editorialActivity ? 'edge_api_editorial_activity'
          : editorialLegacyEntries ? 'edge_api_editorial_legacy_entries'
          : editorialQueue ? 'edge_api_editorial_queue'
          : editorialHistory ? 'edge_api_editorial_revision_history'
          : editorialTimeline ? 'edge_api_editorial_concept_timeline'
          : editorialJobs ? 'edge_api_editorial_generation_jobs'
          : editorialJob ? 'edge_api_editorial_generation_job'
          : editorialLegacyEligibility ? 'edge_api_editorial_legacy_eligibility'
          : editorialLegacyBatches ? 'edge_api_editorial_legacy_batches'
          : editorialSupply ? 'edge_api_editorial_generation_supply' : 'edge_api_editorial_me', {
          p_user_id: userId, p_session_id: claims.sessionId, p_aal: claims.aal,
          ...(editorialReviewers || editorialTaxonomy || editorialActivity || editorialQueue
            || editorialHistory || editorialJobs || editorialNotifications
            ? { p_cursor: cursor, p_limit: Number(rawLimit) } : {}),
          ...(editorialActivity ? { p_topic_id: topicId } : {}),
          ...(editorialLegacyEntries ? { p_batch_id: editorialLegacyEntries[1] } : {}),
          ...(editorialHistory ? { p_concept_id: editorialHistory[1] } : {}),
          ...(editorialTimeline ? { p_concept_id: editorialTimeline[1],
            p_after_at: timelineInput!.afterAt, p_after_key: timelineInput!.afterKey,
            p_limit: timelineInput!.limit } : {}),
          ...(editorialJobs ? { p_status: jobStatus, p_topic_id: topicId,
            p_concept_id: jobConcept } : {}),
          ...(editorialJob ? { p_job_id: editorialJob[1] } : {}),
          ...(editorialSupply ? { p_topic_id: editorialSupply[1],
            p_floor: config.minPoolPerTopic ?? 25,
            p_review_capacity: config.contentReviewBacklogLimit ?? 25,
            p_generation_enabled: Boolean(config.generationEnabled && config.futureRefillEnabled),
            p_provider_configured: Boolean(config.providerConfigured) } : {}),
          ...(editorialLegacyEligibility ? {
            p_topic_id: editorialLegacyEligibility[1],
            p_configured: Boolean(config.generationEnabled && config.legacyEnrichmentEnabled
              && config.providerConfigured && (config.geminiModel ?? 'gemini-3.1-flash-lite').startsWith('gemini-3')),
          } : {}),
          ...(editorialLegacyBatches ? { p_topic_id: topicId } : {}),
          ...(editorialNotifications ? {
            p_setup_status: editorialEmailSetupStatus(config),
            p_daily_cap: config.editorialEmailDailyCap ?? 40,
          } : {}),
          ...(editorialQueue ? { p_kind: queueKind, p_status: queueStatus,
            p_topic_id: topicId, p_assignee_id: queueAssignee, p_subtopic_id: queueSubtopic,
            p_urgency: queueUrgency, p_search: queueSearch } : {}),
          ...(profileInput ? { p_expected_version: profileInput.version,
            p_registered_name: profileInput.name } : {}),
          ...(timezoneInput ? { p_expected_version: timezoneInput.version,
            p_timezone: timezoneInput.timezone } : {}),
          ...(authenticatorInput ? { p_expected_version: authenticatorInput.version,
            p_require_mfa: authenticatorInput.required,
            p_mfa_verified_at: claims.mfaVerifiedAt } : {}),
          ...(editorialApproveProfile ? { p_subject_id: editorialApproveProfile[1],
            p_expected_version: approvalVersion } : {}),
          ...(policyInput ? { p_expected_version: policyInput.version,
            p_deadline_hours: policyInput.deadline, p_reminder_hours: policyInput.reminder,
            p_max_reminders: policyInput.maxReminders } : {}),
          ...(editorialNotificationRetry ? { p_batch_id: editorialNotificationRetry[1],
            p_expected_version: retryVersion, p_setup_status: editorialEmailSetupStatus(config) } : {}),
          ...(editorialOwnerOperations ? {
            p_environment: config.environment ?? 'development',
            p_telemetry_enabled: Boolean(config.ownerTelemetryEnabled),
            p_generation_enabled: Boolean(config.generationEnabled),
            p_future_refill_enabled: Boolean(config.futureRefillEnabled),
            p_legacy_enrichment_enabled: Boolean(config.legacyEnrichmentEnabled),
            p_auto_correction_enabled: config.editorialAutoCorrectionEnabled ?? true,
            p_email_enabled: Boolean(config.editorialEmailEnabled),
            p_generation_daily_cap: config.generationDailyCallCap ?? 200,
          } : {}),
          ...(ownerDates ? { p_start: ownerDates.start, p_end: ownerDates.end } : {}),
          ...(editorialOwnerReviewers ? { p_cursor: cursor, p_limit: Number(rawLimit) } : {}),
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (data.error === 'session_required') {
          return editorialResponse({ detail: 'A confirmed account and current session are required' }, 401, cors, true);
        }
        if (data.error === 'unavailable') {
          return editorialResponse({ detail: 'Editorial access is unavailable' }, 403, cors);
        }
        if (data.error === 'permission') return editorialResponse({ detail: 'Editorial permission required' }, 403, cors);
        if (data.error === 'profile_required') {
          return editorialResponse({ detail: 'Complete profile setup and obtain name approval' }, 403, cors);
        }
        if (data.error === 'mfa_required') {
          return editorialResponse({ detail: 'Complete MFA verification for editorial actions' }, 403, cors);
        }
        if (data.error === 'invalid_page') return editorialResponse({ detail: pageDetail }, 422, cors);
        if (data.error === 'invalid_end') {
          return editorialResponse({ detail: 'End date must allow a 30-day activity window' }, 422, cors);
        }
        if (data.error === 'invalid_range') {
          return editorialResponse({ detail: 'Choose an ordered UTC range of at most 90 days, ending no later than today' }, 422, cors);
        }
        if (data.error === 'invalid_cursor') {
          return editorialResponse({ detail: 'Invalid timeline cursor' }, 422, cors);
        }
        if (data.error === 'invalid_filter') {
          return editorialResponse({ detail: 'Status, assignee and urgency apply to revisions only' }, 422, cors);
        }
        if (data.error === 'batch_not_found') {
          return editorialResponse({ detail: 'Legacy enrichment batch not found' }, 404, cors);
        }
        if (data.error === 'concept_not_found') {
          return editorialResponse({ detail: 'Concept not found' }, 404, cors);
        }
        if (data.error === 'job_not_found') {
          return editorialResponse({ detail: 'Generation job not found' }, 404, cors);
        }
        if (data.error === 'topic_not_found') {
          return editorialResponse({ detail: 'Topic not found' }, 404, cors);
        }
        if (data.error === 'active_topic_not_found') {
          return editorialResponse({ detail: 'Active subject not found' }, 404, cors);
        }
        if (data.error === 'invalid_config') {
          return editorialResponse({ detail: 'Editorial supply unavailable' }, 503, cors);
        }
        if (data.error === 'invalid') return editorialResponse({ detail: 'Invalid editorial profile' }, 422, cors);
        if (data.error === 'unknown_timezone') {
          return editorialResponse({ detail: 'Invalid editorial notification timezone' }, 422, cors);
        }
        if (data.error === 'recent_mfa_required') {
          return editorialResponse({ detail: 'Verify a current authenticator code before turning it off' }, 403, cors);
        }
        if (data.error === 'self_approval') {
          return editorialResponse({ detail: 'Another administrator must approve your name change' }, 403, cors);
        }
        if (data.error === 'request_required') {
          return editorialResponse({ detail: 'An active reviewer must first submit their profile' }, 409, cors);
        }
        if (data.error === 'version_conflict') {
          return editorialResponse({ detail: 'Account changed; reload before saving' }, 409, cors);
        }
        if (data.error === 'policy_conflict') {
          return editorialResponse({ detail: 'Policy changed; refresh before saving' }, 409, cors);
        }
        if (data.error === 'invalid_policy') {
          return editorialResponse({ detail: 'Invalid editorial notification policy' }, 422, cors);
        }
        if (data.error === 'sender_setup_required') {
          return editorialResponse({ detail: 'Complete sender setup before retrying' }, 409, cors);
        }
        if (data.error === 'delivery_not_found') {
          return editorialResponse({ detail: 'Delivery not found' }, 404, cors);
        }
        if (data.error === 'delivery_conflict') {
          return editorialResponse({ detail: 'Delivery changed or its five-attempt budget is exhausted' }, 409, cors);
        }
        return editorialResponse(data, 200, cors);
      }
      if (path === '/v1/topics') {
        return response(await rpc('edge_api_topics', { p_user_id: userId }, config, fetcher), 200, cors);
      }
      if (weeklyQuiz) {
        const quiz = await rpc('edge_api_weekly_quiz', { p_user_id: userId }, config, fetcher);
        return quiz === null ? unavailable(cors) : response(quiz, 200, cors);
      }
      if (subtopicQuiz) {
        if (!UUID.test(subtopicQuiz[1])) return httpError(422, 'Invalid completion ID', cors);
        const quiz = await rpc('edge_api_subtopic_quiz', {
          p_user_id: userId, p_completion_id: subtopicQuiz[1],
        }, config, fetcher) as JsonObject | null;
        if (quiz === null) return unavailable(cors);
        return quiz.error === 'unavailable'
          ? httpError(404, 'Completed subtopic not found', cors)
          : response(quiz, 200, cors);
      }
      if (weeklyAttempt) {
        if (!UUID.test(weeklyAttempt[1])) return httpError(422, 'Invalid quiz ID', cors);
        const answers = quizAnswers((await readJson(request))!, 7, 7);
        const attempt = await rpc('edge_api_submit_weekly_quiz', {
          p_user_id: userId, p_quiz_id: weeklyAttempt[1], p_answers: answers,
        }, config, fetcher) as JsonObject | null;
        if (attempt === null) return unavailable(cors);
        if (attempt.error === 'unavailable') return httpError(400, 'Weekly quiz not found', cors);
        if (attempt.error === 'invalid') return httpError(400, 'Answers must match this quiz exactly', cors);
        return response(attempt, 200, cors);
      }
      if (subtopicAttempt) {
        if (!UUID.test(subtopicAttempt[1])) return httpError(422, 'Invalid quiz ID', cors);
        if (request.method === 'GET') {
          const history = await rpc('edge_api_subtopic_quiz_attempts', {
            p_user_id: userId, p_completion_id: subtopicAttempt[1],
          }, config, fetcher) as JsonObject | null;
          if (history === null) return unavailable(cors);
          return history.error === 'unavailable'
            ? httpError(404, 'Completed subtopic not found', cors)
            : response(history, 200, cors);
        }
        const answers = quizAnswers((await readJson(request))!, 1, 7);
        const attempt = await rpc('edge_api_submit_subtopic_quiz', {
          p_user_id: userId, p_quiz_id: subtopicAttempt[1], p_answers: answers,
        }, config, fetcher) as JsonObject | null;
        if (attempt === null) return unavailable(cors);
        if (attempt.error === 'unavailable') return httpError(400, 'Subtopic quiz not found', cors);
        if (attempt.error === 'invalid') return httpError(400, 'Answers must match this quiz exactly', cors);
        return response(attempt, 200, cors);
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
      if (analytics) {
        const data = await rpc('edge_api_analytics', { p_user_id: userId }, config, fetcher);
        return data === null ? unavailable(cors) : response(data, 200, cors);
      }
      if (sharing) {
        const args = request.method === 'PUT' ? sharingInput((await readJson(request))!) : {};
        const data = await rpc(request.method === 'PUT' ? 'edge_api_sharing_put' : 'edge_api_sharing_get',
          { p_user_id: userId, ...args }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (data.error === 'version_conflict') {
          return sharingResponse({ detail: 'Settings changed. Reload before saving.' }, 409, cors);
        }
        if (data.error === 'unearned_achievements') {
          return sharingResponse({ detail: 'Only earned achievements can be shared' }, 422, cors);
        }
        return sharingResponse(data, 200, cors);
      }
      if (connectionSettings) {
        const args = request.method === 'PUT' ? connectionSettingsInput((await readJson(request))!) : {};
        const data = await rpc(request.method === 'PUT'
          ? 'edge_api_connection_settings_put' : 'edge_api_connection_settings_get',
        { p_user_id: userId, ...args }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (data.error === 'version_conflict') {
          return sharingResponse({ detail: 'Settings changed. Reload before saving.' }, 409, cors);
        }
        return sharingResponse(data, 200, cors);
      }
      if (connectionList) {
        const input = connectionPageInput(requestUrl.searchParams);
        const data = await rpc('edge_api_connections', {
          p_user_id: userId, p_kind: input.kind,
          p_cursor: input.cursor, p_limit: input.limit,
        }, config, fetcher);
        return data === null ? unavailable(cors) : sharingResponse(data, 200, cors);
      }
      if (relationshipList) {
        const input = relationshipPageInput(requestUrl.searchParams);
        const data = await rpc('edge_api_relationships', {
          p_user_id: userId, p_cursor_at: input.created,
          p_cursor_id: input.id, p_limit: input.limit,
        }, config, fetcher) as JsonObject | null;
        if (data === null || !Array.isArray(data.items)) return unavailable(cors);
        const raw = data.items as unknown[];
        const mapped = raw.map(value => {
          if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
          const row = value as JsonObject;
          if (typeof row.id !== 'string' || !UUID.test(row.id)
              || typeof row.display_name !== 'string') return null;
          return {
            id: row.id, display_name: row.display_name,
            public_path: typeof row.public_path === 'string'
              && /^\/p\/[A-Za-z0-9_-]{43}$/.test(row.public_path) ? row.public_path : null,
            avatar_ref: typeof row.avatar_ref === 'string'
              && /^preset:(aurora|comet|forest|ocean|sunset|violet)$/.test(row.avatar_ref)
              ? row.avatar_ref : null,
            avatar_url: null as string | null,
          };
        });
        if (mapped.some(value => value === null)) return unavailable(cors);
        const items = mapped as Exclude<(typeof mapped)[number], null>[];
        let next = 0;
        const deadline = Date.now() + 3000;
        await Promise.all(Array.from({ length: Math.min(6, raw.length) }, async () => {
          while (next < raw.length) {
            const index = next++;
            const row = raw[index] as JsonObject;
            if (typeof row.avatar_owner !== 'string' || !UUID.test(row.avatar_owner)) continue;
            const remaining = deadline - Date.now();
            if (remaining <= 0) break;
            items[index].avatar_url = await signedAvatarUrl(
              row.avatar_key, row.avatar_owner, config, fetcher, remaining,
            );
          }
        }));
        return sharingResponse({ items,
          next_cursor: typeof data.next_cursor === 'string' ? data.next_cursor : null }, 200, cors);
      }
      if (connectionStatus) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(connectionStatus[1])) {
          return sharingResponse({ detail: 'Profile unavailable' }, 404, cors);
        }
        const data = await rpc(request.method === 'POST'
          ? 'edge_api_connection_request' : 'edge_api_connection_status', {
          p_user_id: userId, p_token: connectionStatus[1],
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (request.method === 'POST' && typeof data.error === 'string') {
          const errors: Record<string, { status: number; detail: string }> = {
            unavailable: { status: 404, detail: 'This connection is unavailable' },
            self: { status: 400, detail: 'You cannot connect with yourself' },
            incoming: { status: 409, detail: 'An incoming request already exists. Accept or decline it.' },
            cooldown: { status: 429, detail: 'Please wait before requesting again' },
            limit: { status: 429, detail: 'Connection request limit reached. Try later.' },
          };
          const mapped = errors[data.error];
          if (!mapped) return unavailable(cors);
          const result = sharingResponse({ detail: mapped.detail }, mapped.status, cors);
          if (mapped.status === 429 && typeof data.retry_after === 'number'
              && data.retry_after > 0 && Number.isSafeInteger(data.retry_after)) {
            result.headers.set('retry-after', String(data.retry_after));
          }
          return result;
        }
        return sharingResponse(data, 200, cors);
      }
      if (connectionBlock || relationshipBlock) {
        const sharedToken = (connectionBlock ?? relationshipBlock)![1];
        if (!/^[A-Za-z0-9_-]{43}$/.test(sharedToken)) {
          return sharingResponse({ detail: 'Profile unavailable' }, 404, cors);
        }
        const data = await rpc('edge_api_connection_block_token', {
          p_user_id: userId, p_token: sharedToken,
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (data.error === 'unavailable') {
          return sharingResponse({ detail: 'This connection is unavailable' }, 404, cors);
        }
        if (data.error === 'self') {
          return relationshipBlock
            ? sharingResponse({ detail: 'This profile is unavailable' }, 404, cors)
            : sharingResponse({ detail: 'You cannot block yourself' }, 400, cors);
        }
        return data.ok === true ? privateNoContent(cors) : unavailable(cors);
      }
      if (connectionAction) {
        if (!UUID.test(connectionAction[1])) {
          return sharingResponse({ detail: 'Invalid connection ID' }, 422, cors);
        }
        const body = await readJson(request);
        const data = await rpc('edge_api_connection_action', {
          p_user_id: userId, p_connection_id: connectionAction[1],
          p_action: connectionActionInput(body!),
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        const errors: Record<string, { status: number; detail: string }> = {
          unavailable: { status: 404, detail: 'This connection is unavailable' },
          recipient_only: { status: 403, detail: 'Only the recipient can answer a request' },
          sender_only: { status: 403, detail: 'Only the sender can cancel a request' },
          changed: { status: 409, detail: 'This request has changed. Reload the list.' },
          invalid: { status: 422, detail: 'Invalid connection action' },
        };
        const mapped = typeof data.error === 'string' ? errors[data.error] : undefined;
        if (mapped) return sharingResponse({ detail: mapped.detail }, mapped.status, cors);
        return data.ok === true ? privateNoContent(cors) : unavailable(cors);
      }
      if (connectionUnblock) {
        if (!UUID.test(connectionUnblock[1])) {
          return sharingResponse({ detail: 'Invalid block ID' }, 422, cors);
        }
        const data = await rpc('edge_api_connection_unblock', {
          p_user_id: userId, p_block_id: connectionUnblock[1],
        }, config, fetcher) as JsonObject | null;
        return data?.ok === true ? privateNoContent(cors) : unavailable(cors);
      }
      if (relationshipStatus) {
        if (!/^[A-Za-z0-9_-]{43}$/.test(relationshipStatus[1])) {
          return sharingResponse({ detail: 'Profile unavailable' }, 404, cors);
        }
        const data = await rpc(request.method === 'POST'
          ? 'edge_api_relationship_connect' : 'edge_api_relationship_status', {
          p_user_id: userId, p_token: relationshipStatus[1],
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (request.method === 'POST' && data.error === 'unavailable') {
          return sharingResponse({ detail: 'This profile is unavailable' }, 404, cors);
        }
        if (request.method === 'POST' && data.error === 'limit') {
          const result = sharingResponse({ detail: 'Connection limit reached. Try again tomorrow.' }, 429, cors);
          result.headers.set('retry-after', '86400');
          return result;
        }
        return sharingResponse(data, 200, cors);
      }
      if (relationshipRemove) {
        if (!UUID.test(relationshipRemove[1])) {
          return sharingResponse({ detail: 'Invalid relationship ID' }, 422, cors);
        }
        const data = await rpc('edge_api_relationship_remove', {
          p_user_id: userId, p_relationship_id: relationshipRemove[1],
        }, config, fetcher) as JsonObject | null;
        return data?.ok === true ? privateNoContent(cors) : unavailable(cors);
      }
      if (relationshipBlockById) {
        if (!UUID.test(relationshipBlockById[1])) {
          return sharingResponse({ detail: 'Invalid relationship ID' }, 422, cors);
        }
        const data = await rpc('edge_api_relationship_block', {
          p_user_id: userId, p_relationship_id: relationshipBlockById[1],
        }, config, fetcher) as JsonObject | null;
        return data?.ok === true ? privateNoContent(cors) : unavailable(cors);
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
      if (profile) {
        const body = await readJson(request);
        const input = profileInput(body!);
        const data = await rpc('edge_api_patch_profile', {
          p_user_id: userId, p_display_name: input.displayName,
          p_has_bio: input.hasBio, p_bio: input.bio, p_avatar_preset: input.preset,
          p_timezone: input.timezone, p_initialize_timezone: input.initializeTimezone,
          p_compact: queryBoolean(requestUrl.searchParams, 'compact'), p_today: null,
        }, config, fetcher) as JsonObject | null;
        if (data === null) return unavailable(cors);
        if (data.error === 'unknown_timezone') return httpError(400, 'Unknown timezone', cors);
        if (typeof data.state !== 'object' || data.state === null || Array.isArray(data.state)) {
          return unavailable(cors);
        }
        await deleteOldAvatar(data.old_avatar_ref, userId, config, fetcher);
        const state = data.state as JsonObject;
        state.avatar_url = await signedAvatarUrl(state.avatar_ref, userId, config, fetcher);
        return response(state, 200, cors);
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
      const result = unavailable(cors);
      const source = failure instanceof UpstreamError
        ? `${failure.component}:${failure.status}` : 'internal';
      console.error(`Candidate API incident ${result.headers.get('x-incident-id')}: ${source}`);
      return result;
    }
  };
}
