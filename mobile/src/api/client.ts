/**
 * Thin HTTP client for the FastAPI backend.
 *
 * The access token is supplied by a provider function so this
 * module never imports the auth stack (and never stores a token itself).
 */

import { fetchWithTimeout } from './fetchWithTimeout';
import { API_BASE_URL, assertApiConfigured } from './config';
export { API_BASE_URL, isApiConfigured } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly detail?: unknown;
  readonly retryAfterMs: number;
  constructor(
    status: number,
    message: string,
    detail?: unknown,
    retryAfterMs = 0,
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.retryAfterMs = retryAfterMs;
  }
}

type TokenProvider = (expectedUserId?: string) => Promise<string | null>;

let getAccessToken: TokenProvider = async () => null;
let accountEpoch = 0;
let retryUntil = 0;

export function apiRetryDelay(): number {
  return Math.max(0, retryUntil - Date.now());
}

export function parseRetryAfter(value: string | null, now = Date.now()): number {
  if (!value) return 0;
  const seconds = Number(value);
  const delay = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(delay) ? Math.max(0, delay) : 0;
}

/** Cancel requests still waiting for a token when the account is cleared. */
export function invalidateAccountRequests(): void {
  accountEpoch += 1;
  retryUntil = 0;
}

/** Registered once by the auth layer in Phase 3. */
export function setTokenProvider(provider: TokenProvider): void {
  getAccessToken = provider;
}

// --- Connectivity, inferred from request outcomes (no native listener) -------
// We learn we're offline when a fetch throws (no response), and back online the
// moment any request reaches the server (even an HTTP error is "reachable").
// The app subscribes to drive a global offline banner + the sync queue.
let online = true;
const connectivityListeners = new Set<(online: boolean) => void>();

export function getConnectivity(): boolean {
  return online;
}

export function subscribeConnectivity(fn: (online: boolean) => void): () => void {
  connectivityListeners.add(fn);
  return () => {
    connectivityListeners.delete(fn);
  };
}

export function setConnectivity(next: boolean): void {
  if (next === online) return;
  online = next;
  connectivityListeners.forEach((fn) => fn(next));
}

interface RequestOptions {
  /** Account-scoped requests must never borrow a replacement account token. */
  expectedUserId?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
}

/**
 * Perform an authenticated JSON request.
 *
 * The user is never identified by the request body — the backend derives
 * identity from this bearer token alone.
 */
export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  assertApiConfigured();

  const epoch = accountEpoch;
  if (apiRetryDelay()) throw new ApiError(429, 'Please wait before retrying', undefined, apiRetryDelay());
  const token = await getAccessToken(options.expectedUserId);
  if (epoch !== accountEpoch) throw new ApiError(401, 'Account changed');
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    if (epoch !== accountEpoch) throw new ApiError(401, 'Account changed');
    // Offline or unreachable host: callers fall back to cached state.
    setConnectivity(false);
    throw new ApiError(0, 'Network request failed', cause);
  }
  if (epoch !== accountEpoch) throw new ApiError(401, 'Account changed');

  if (epoch !== accountEpoch) throw new ApiError(401, 'Account changed');

  // Got a response (even a 4xx/5xx) — the server is reachable, so we're online.
  setConnectivity(true);

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);
  if (epoch !== accountEpoch) throw new ApiError(401, 'Account changed');

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : null;
    const retryAfterMs = parseRetryAfter(response.headers.get('Retry-After'));
    if (response.status === 429 || response.status === 503) {
      retryUntil = Math.max(retryUntil, Date.now() + retryAfterMs);
    }
    throw new ApiError(response.status, `Request failed: ${response.status}`, detail, retryAfterMs);
  }

  return payload as T;
}
