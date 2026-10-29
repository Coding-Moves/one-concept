import { expect, test, type BrowserContext } from "@playwright/test";

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "learner@example.test",
  aud: "authenticated",
  role: "authenticated",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-01-01T00:00:00Z",
};
const token = [
  { alg: "HS256", typ: "JWT" },
  { sub: user.id, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 },
].map(part => Buffer.from(JSON.stringify(part)).toString("base64url")).join(".") + ".test";

async function mockAuth(context: BrowserContext, requests: string[]) {
  await context.route("https://review-auth.test/**", async route => {
    const url = new URL(route.request().url());
    requests.push(`${route.request().method()} ${url.pathname}${url.search}`);
    const headers = {
      "access-control-allow-origin": "*",
      "access-control-allow-headers": "*",
      "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    };
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers });
    if (url.pathname.endsWith("/signup")) return route.fulfill({ status: 200, headers,
      contentType: "application/json", body: JSON.stringify({ user, session: null }) });
    if (url.pathname.endsWith("/recover") || url.pathname.endsWith("/resend") || url.pathname.endsWith("/logout")) {
      return route.fulfill({ status: 200, headers, contentType: "application/json", body: "{}" });
    }
    if (url.pathname.endsWith("/user")) return route.fulfill({ status: 200, headers,
      contentType: "application/json", body: JSON.stringify(user) });
    return route.fulfill({ status: 200, headers, contentType: "application/json",
      body: JSON.stringify({ access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, user }) });
  });
}

test("public signup uses the shared Auth project and exact callback without granting review access", async ({ page, context }) => {
  const requests: string[] = [];
  await mockAuth(context, requests);
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("safe-test-password");
  await page.getByLabel("Confirm password").fill("safe-test-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(requests.some(request => request.startsWith("POST /auth/v1/signup?redirect_to=http%3A%2F%2F127.0.0.1%3A4173%2Faccount%2Fcallback"))).toBe(true);
  expect(requests.some(request => request.includes("/editorial"))).toBe(false);
  await page.getByRole("button", { name: "Send another email" }).click();
  await expect(page.getByRole("status")).toContainText("another email");
});

test("recovery email return verifies the session, updates the password, and clears the URL", async ({ page, context }) => {
  const requests: string[] = [];
  await mockAuth(context, requests);
  await page.goto("/account");
  await page.getByRole("button", { name: "Forgot password?" }).click();
  await page.getByLabel("Email address").fill(user.email);
  await page.getByRole("button", { name: "Send reset email" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  expect(requests.some(request => request.startsWith("POST /auth/v1/recover?redirect_to=http%3A%2F%2F127.0.0.1%3A4173%2Faccount%2Fcallback"))).toBe(true);
  await page.goto(`/account/callback#access_token=${encodeURIComponent(token)}&refresh_token=fixture-refresh&type=recovery`);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await expect(page).toHaveURL("http://127.0.0.1:4173/account");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await page.getByLabel("New password").fill("new-safe-password");
  await page.getByLabel("Confirm password").fill("new-safe-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("status")).toContainText("Password updated");
  expect(requests.some(request => request === "PUT /auth/v1/user")).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});

test("recovery form refuses to change a different account's password after a session switch", async ({ page, context }) => {
  const requests: string[] = [];
  await mockAuth(context, requests);
  await page.goto(`/account/callback#access_token=${encodeURIComponent(token)}&refresh_token=fixture-refresh&type=recovery`);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  const otherUser = { ...user, id: "00000000-0000-4000-8000-000000000002", email: "other@example.test" };
  await context.route("https://review-auth.test/auth/v1/user", route => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(otherUser),
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
  }));
  await page.getByLabel("New password").fill("new-safe-password");
  await page.getByLabel("Confirm password").fill("new-safe-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toContainText("account changed");
  await expect(page.getByRole("heading", { name: "Set a new password" })).toHaveCount(0);
  expect(requests.some(request => request === "PUT /auth/v1/user")).toBe(false);
});

test("invalid callbacks never offer password setup", async ({ page, context }) => {
  const requests: string[] = [];
  await mockAuth(context, requests);
  await page.goto("/account/callback#access_token=partial&type=recovery");
  await expect(page.getByRole("alert")).toContainText("invalid or has expired");
  await expect(page.getByRole("heading", { name: "Set a new password" })).toHaveCount(0);
  await expect(page).toHaveURL("http://127.0.0.1:4173/account");
  expect(requests.some(request => request.includes("/editorial"))).toBe(false);
});

test("confirmation callback verifies the account and remains distinct from reviewer access", async ({ page, context }) => {
  const requests: string[] = [];
  await mockAuth(context, requests);
  await page.goto(`/account/callback#access_token=${encodeURIComponent(token)}&refresh_token=fixture-refresh&type=signup`);
  await expect(page.getByRole("heading", { name: "You're signed in" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("Email link verified");
  await expect(page).toHaveURL("http://127.0.0.1:4173/account");
  const keys = await page.evaluate(() => Object.keys(localStorage));
  expect(keys).toContain("one-concept-public-account");
  expect(keys).not.toContain("one-concept-review-auth");
  expect(requests.some(request => request === "GET /auth/v1/user")).toBe(true);
});

test("wrong password and rate limited signup show safe actionable errors", async ({ page, context }) => {
  const requests: string[] = [];
  await mockAuth(context, requests);
  await context.route("https://review-auth.test/auth/v1/token*", route => route.fulfill({ status: 400,
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
    contentType: "application/json", body: JSON.stringify({ code: "invalid_credentials", msg: "Invalid login credentials" }) }));
  await page.goto("/account");
  await page.getByLabel("Email address").fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill("wrong-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Check your email and password");
  await context.route("https://review-auth.test/auth/v1/signup*", route => route.fulfill({ status: 429,
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*" },
    contentType: "application/json", body: JSON.stringify({ code: "over_email_send_rate_limit", msg: "Too many requests" }) }));
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Password", { exact: true }).fill("safe-test-password");
  await page.getByLabel("Confirm password").fill("safe-test-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("Wait a while and try again");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await context.route("https://review-auth.test/auth/v1/signup*", route => route.fulfill({ status: 422,
    headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-expose-headers": "x-supabase-api-version", "x-supabase-api-version": "2024-01-01" },
    contentType: "application/json", body: JSON.stringify({ code: "weak_password", msg: "Weak password" }) }));
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("alert")).toContainText("Choose a stronger password");
});

test("account layout keeps the existing icon in bounds on a narrow dark screen", async ({ page, context }) => {
  await mockAuth(context, []);
  await page.setViewportSize({ width: 360, height: 760 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  const layout = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    viewportWidth: innerWidth,
    icon: document.querySelector<HTMLImageElement>(".account-brand img")?.getBoundingClientRect().toJSON(),
    loaded: document.querySelector<HTMLImageElement>(".account-brand img")?.naturalWidth,
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.viewportWidth);
  expect(layout.loaded).toBeGreaterThan(0);
  expect(layout.icon?.width).toBe(56);
  expect(layout.icon?.height).toBe(56);
});
