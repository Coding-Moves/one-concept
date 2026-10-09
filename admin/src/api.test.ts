import { afterEach, describe, expect, it, vi } from "vitest";
import { Api, ApiError, safeUrl, command } from "./api";
import { readConfig } from "./config";
afterEach(() => vi.unstubAllGlobals());
describe("private request boundaries", () => {
  it("discards an old account response, including late JSON parsing", async () => {
    let finish!: (v: unknown) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: () =>
          new Promise((r) => {
            finish = r;
          }),
      })),
    );
    const api = new Api("https://api.test");
    api.setToken("first", true);
    const pending = api.request("/queue");
    await vi.waitFor(() => expect(finish).toBeDefined());
    api.setToken("second", true);
    finish({ items: ["private"] });
    await expect(pending).rejects.toMatchObject({ status: 499 });
  });
  it("denies redirects, omits cookies and disables caching", async () => {
    const fetch = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetch);
    const api = new Api("https://api.test");
    api.setToken("test-token");
    await api.request("/me");
    expect(fetch.mock.calls[0]).toEqual([
      "https://api.test/v1/editorial/me",
      expect.objectContaining({
        redirect: "error",
        cache: "no-store",
        credentials: "omit",
      }),
    ]);
  });
  it("refreshes an idle session before sending a private request", async () => {
    const fetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}"),
    );
    vi.stubGlobal("fetch", fetch);
    const currentSession = vi.fn(async () => ({
      token: "fresh-token",
      userId: "owner",
    }));
    const api = new Api("https://api.test", currentSession);
    api.setToken("expired-token", true, "owner");
    api.onDenied = vi.fn();
    await api.request("/me");
    expect(currentSession).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: { Authorization: "Bearer fresh-token" },
    });
    expect(api.onDenied).not.toHaveBeenCalled();
  });
  it("keeps the session and unsent work on a temporary refresh failure", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = new Api("https://api.test", async () => {
      throw new Error("network unavailable");
    });
    api.setToken("expired-token", true, "owner");
    api.onDenied = vi.fn();
    await expect(
      api.request("/review", "POST", { decision: "comment" }),
    ).rejects.toMatchObject({ status: 0 });
    expect(fetch).not.toHaveBeenCalled();
    expect(api.onDenied).not.toHaveBeenCalled();
  });
  it("does not sign out for a denial from an older token", async () => {
    let respond!: (value: Response) => void;
    const fetch = vi.fn(
      () => new Promise<Response>((resolve) => { respond = resolve; }),
    );
    vi.stubGlobal("fetch", fetch);
    const api = new Api("https://api.test");
    api.setToken("old-token");
    api.onDenied = vi.fn();
    const pending = api.request("/me");
    await vi.waitFor(() => expect(respond).toBeDefined());
    api.setToken("fresh-token");
    respond(new Response("{}", { status: 401 }));
    await expect(pending).rejects.toMatchObject({ status: 499 });
    expect(api.onDenied).not.toHaveBeenCalled();
  });
  it("fences a session refresh that finishes after an account switch", async () => {
    let resolveSession!: (session: { token: string; userId: string }) => void;
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = new Api(
      "https://api.test",
      () => new Promise((resolve) => { resolveSession = resolve; }),
    );
    api.setToken("first", true, "first-user");
    const pending = api.request("/me");
    api.setToken("second", true, "second-user");
    resolveSession({ token: "first-refreshed", userId: "first-user" });
    await expect(pending).rejects.toMatchObject({ status: 499 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("does not show another account's data before its auth event arrives", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = new Api("https://api.test", async () => ({
      token: "other-token",
      userId: "other-user",
    }));
    api.setToken("owner-token", true, "owner");
    await expect(api.request("/me")).rejects.toMatchObject({ status: 499 });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("ends a genuinely missing session before contacting the backend", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const api = new Api("https://api.test", async () => null);
    api.setToken("expired-token", true, "owner");
    api.onDenied = vi.fn();
    await expect(api.request("/me")).rejects.toMatchObject({ status: 401 });
    expect(fetch).not.toHaveBeenCalled();
    expect(api.onDenied).toHaveBeenCalledWith(401);
  });
  it("does not echo server diagnostics and signals revoked authority", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("secret diagnostics", { status: 403 })),
    );
    const api = new Api("https://api.test");
    api.setToken("t");
    api.onDenied = vi.fn();
    await expect(api.request("/queue")).rejects.toBeInstanceOf(ApiError);
    expect(api.onDenied).toHaveBeenCalledWith(403);
  });
  it("creates a unique operation with an exact source token", () => {
    const a = command("source", "Checked references");
    expect(a.expected_token).toBe("source");
    expect(a.request_id).not.toBe(
      command("source", "Checked references").request_id,
    );
  });
  it("rejects executable and credential-bearing links", () => {
    expect(safeUrl("javascript:alert(1)")).toBeUndefined();
    expect(safeUrl("https://user:password@example.com")).toBeUndefined();
    expect(safeUrl("https://example.com/docs")).toBe(
      "https://example.com/docs",
    );
  });
  it("rejects privileged build keys and insecure origins", () => {
    const base = {
      VITE_API_URL: "https://api.test",
      VITE_SUPABASE_URL: "https://auth.test",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    };
    expect(readConfig(base).apiUrl).toBe("https://api.test");
    expect(() =>
      readConfig({
        ...base,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_private",
      }),
    ).toThrow();
    expect(() =>
      readConfig({
        ...base,
        VITE_SUPABASE_PUBLISHABLE_KEY:
          "x." + btoa(JSON.stringify({ role: "service_role" })) + ".x",
      }),
    ).toThrow();
    expect(() =>
      readConfig({ ...base, VITE_API_URL: "http://api.test" }),
    ).toThrow();
  });
});
