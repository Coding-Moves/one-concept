export type EmailReturn =
  | { kind: "none" }
  | { kind: "error" }
  | { kind: "session"; accessToken: string; refreshToken: string; type: string }
  | { kind: "code"; code: string; type: string };

export const accountCallbackPath = "/account/callback";

export function emailReturn(url: URL): EmailReturn {
  const hash = new URLSearchParams(url.hash.slice(1));
  const query = url.searchParams;
  if (hash.has("error") || hash.has("error_description") || query.has("error") ||
      query.has("error_description")) return { kind: "error" };
  if (url.pathname !== accountCallbackPath) return { kind: "none" };
  const type = hash.get("type") || query.get("type") || "";
  const accessToken = hash.get("access_token");
  const refreshToken = hash.get("refresh_token");
  if (accessToken && refreshToken) return { kind: "session", accessToken, refreshToken, type };
  const code = query.get("code");
  if (code) return { kind: "code", code, type };
  if (url.hash || url.search) return { kind: "error" };
  return { kind: "none" };
}

export function callbackUrl(origin: string): string {
  return new URL(accountCallbackPath, origin).toString();
}
