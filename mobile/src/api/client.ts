/**
 * Thin HTTP client for the FastAPI backend.
 *
 * Not wired into any screen yet — it lands here in Phase 0 so the base URL,
 * auth header, and error shape are settled before Phase 2 starts returning
 * real data. The access token is supplied by a provider function so this
 * module never imports the auth stack (and never stores a token itself).
 */

/** Public config only. Secrets live in backend/.env, never in the bundle. */
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type TokenProvider = () => Promise<string | null>;

let getAccessToken: TokenProvider = async () => null;

/** Registered once by the auth layer in Phase 3. */
export function setTokenProvider(provider: TokenProvider): void {
  getAccessToken = provider;
}

export function isApiConfigured(): boolean {
  return API_BASE_URL.length > 0;
}

interface RequestOptions {
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
  if (!isApiConfigured()) {
    throw new ApiError(0, 'EXPO_PUBLIC_API_BASE_URL is not set');
  }

  const token = await getAccessToken();
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers.Authorization = `Bearer ${token}`;

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (cause) {
    // Offline or unreachable host: callers fall back to cached state.
    throw new ApiError(0, 'Network request failed', cause);
  }

  if (response.status === 204) return undefined as T;

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const detail =
      payload && typeof payload === 'object' && 'detail' in payload
        ? (payload as { detail: unknown }).detail
        : null;
    throw new ApiError(response.status, `Request failed: ${response.status}`, detail);
  }

  return payload as T;
}
