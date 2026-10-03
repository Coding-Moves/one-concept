import { describe, expect, it } from "vitest";
import { pagesHeaders } from "./hosting";

describe("static-host response headers", () => {
  it("restricts browser connections to the configured API and Auth origins", () => {
    const headers = pagesHeaders({
      apiUrl: "https://api.example.test",
      supabaseUrl: "https://auth.example.test",
    });
    expect(headers).toContain("connect-src 'self' https://api.example.test https://auth.example.test;");
    expect(headers).not.toMatch(/connect-src 'self' https:(?:\s|;)/);
    expect(headers).not.toContain("localhost");
    expect(headers).toContain("Cache-Control: no-store");
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow, noarchive");
    expect(headers).toContain("style-src-attr 'unsafe-inline'");
  });
});
