export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message);
  }
}
interface AccessSession {
  token: string;
  userId: string;
}
export class Api {
  private epoch = 0;
  private token: string | null = null;
  private accountId: string | null = null;
  private tokenRevision = 0;
  onDenied: (status: number) => void = () => {};
  constructor(
    readonly base: string,
    private readonly currentSession?: () => Promise<AccessSession | null>,
  ) {}
  setToken(token: string | null, reset = false, userId?: string | null) {
    if (reset) this.epoch++;
    if (userId !== undefined) this.accountId = userId;
    if (token !== this.token) this.tokenRevision++;
    this.token = token;
  }
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const epoch = this.epoch;
    let token = this.token;
    if (this.currentSession) {
      let current: AccessSession | null;
      try {
        current = await this.currentSession();
      } catch {
        if (epoch !== this.epoch) throw new ApiError(499, "Account changed.");
        throw new ApiError(0, "Unable to refresh your sign-in. Try again.");
      }
      if (epoch !== this.epoch) throw new ApiError(499, "Account changed.");
      if (current && current.userId !== this.accountId)
        throw new ApiError(499, "Account changed.");
      token = current?.token || null;
      if (token) this.setToken(token);
      else if (this.token) this.onDenied(401);
    }
    if (!token) throw new ApiError(401, "Sign in to continue.");
    const tokenRevision = this.tokenRevision;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`${this.base}/v1/editorial${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        cache: "no-store",
        credentials: "omit",
        redirect: "error",
      });
      if (epoch !== this.epoch) throw new ApiError(499, "Account changed.");
      if (!response.ok) {
        if (
          [401, 403].includes(response.status) &&
          tokenRevision !== this.tokenRevision
        )
          throw new ApiError(499, "Session changed.");
        if ([401, 403].includes(response.status))
          this.onDenied(response.status);
        const detail =
          response.status === 409
            ? (await response.json().catch(() => null))?.detail
            : null;
        const code =
          typeof detail?.code === "string" ? detail.code : undefined;
        const message =
          response.status === 409
            ? code === "review_conflict" && typeof detail.message === "string"
              ? detail.message
              : "This item changed or the action is no longer allowed. Reload and review the latest version before deciding."
            : response.status === 422
              ? "Check the required fields and complete lesson package."
              : response.status === 503
                ? "Review services are unavailable. Please try again later."
                : response.status === 401
                  ? "Your session expired. Sign in again."
                  : response.status === 403
                    ? "Your account cannot perform this action."
                    : "The request failed. Your changes have not been confirmed.";
        throw new ApiError(response.status, message, code);
      }
      const result = await response.json();
      if (epoch !== this.epoch) throw new ApiError(499, "Account changed.");
      return result;
    } catch (error) {
      if (epoch !== this.epoch) throw new ApiError(499, "Account changed.");
      if (error instanceof ApiError) throw error;
      throw new ApiError(
        0,
        method === "GET"
          ? "Unable to connect. Try again."
          : "No confirmation received. Retry the identical request to check its result.",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
export interface PendingCommand {
  path: string;
  method: string;
  body: unknown;
}
export function command(
  token: string,
  note: string,
  fields: Record<string, unknown> = {},
) {
  return {
    request_id: crypto.randomUUID(),
    expected_token: token,
    note,
    ...fields,
  };
}
export function safeUrl(value: string) {
  try {
    const u = new URL(value);
    return ["https:", "http:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
