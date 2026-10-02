export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export class Api {
  private epoch = 0;
  private token: string | null = null;
  onDenied: (status: number) => void = () => {};
  constructor(readonly base: string) {}
  setToken(token: string | null, reset = false) {
    if (reset) this.epoch++;
    this.token = token;
  }
  async request<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const epoch = this.epoch,
      token = this.token;
    if (!token) throw new ApiError(401, "Sign in to continue.");
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
        if ([401, 403].includes(response.status))
          this.onDenied(response.status);
        const message =
          response.status === 409
            ? "This item changed or the action is no longer allowed. Reload and review the latest version before deciding."
            : response.status === 422
              ? "Check the required fields and complete lesson package."
              : response.status === 503
                ? "Review services are unavailable. Please try again later."
                : response.status === 401
                  ? "Your session expired. Sign in again."
                  : response.status === 403
                    ? "Your account cannot perform this action."
                    : "The request failed. Your changes have not been confirmed.";
        throw new ApiError(response.status, message);
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
