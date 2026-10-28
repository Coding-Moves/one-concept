import type { readConfig } from "./config.ts";

export function pagesHeaders(config: Pick<ReturnType<typeof readConfig>, "apiUrl" | "supabaseUrl">): string {
  const connectSrc = ["'self'", new URL(config.apiUrl).origin, config.supabaseUrl].join(" ");
  return `/*
  Cache-Control: no-store
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  X-Frame-Options: DENY
  X-Robots-Tag: noindex, nofollow, noarchive
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data: ${config.supabaseUrl}; connect-src ${connectSrc}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'
`;
}
