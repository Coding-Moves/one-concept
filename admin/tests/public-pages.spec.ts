import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const token = "a".repeat(43);
const config = {
  apiUrl: "https://api.example.test/functions/v1/api",
  supabaseUrl: "https://auth.example.test",
  key: "sb_publishable_browser_fixture",
};

test.beforeEach(async ({ page }) => {
  await page.route("**/public-config.js", (route) => route.fulfill({
    contentType: "application/javascript",
    body: `window.ONE_CONCEPT_PUBLIC_CONFIG=${JSON.stringify(config)}`,
  }));
});

test("review privacy policy opens the published learner privacy page", async ({ page }) => {
  const html = await readFile(resolve("public/privacy/index.html"), "utf8");
  await page.route("**/privacy", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/privacy.html");
  await page.getByRole("link", { name: "One Concept learning app privacy policy" }).click();
  await expect(page).toHaveURL(/\/privacy\/?$/);
  await expect(page.getByRole("heading", { name: "Privacy Policy" })).toBeVisible();
});

test("Netlify confirmation stays neutral until an Auth redirect and clears its session", async ({ page }) => {
  const html = await readFile(resolve("public/confirmed/index.html"), "utf8");
  await page.route("**/confirmed", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.goto("/confirmed");
  await expect(page.getByRole("heading", { name: "Check your email link" })).toBeVisible();
  await expect(page).toHaveTitle("One Concept — email confirmation");

  await page.goto("/");
  await page.goto("/confirmed#access_token=confirmed-token&type=signup");
  await expect(page.getByRole("heading", { name: "Email confirmed ✓" })).toBeVisible();
  await expect(page).toHaveURL(/\/confirmed$/);

  await page.goto("/");
  await page.goto("/confirmed#error=access_denied&error_description=Email%20link%20expired");
  await expect(page.getByRole("heading", { name: "Confirmation did not finish" })).toBeVisible();
  await expect(page.locator("#message")).toHaveText("Email link expired");
  await expect(page).toHaveURL(/\/confirmed$/);
});

test("Netlify confirmation forwards a recovery session to its reset form", async ({ page }) => {
  const html = await readFile(resolve("public/confirmed/index.html"), "utf8");
  const reset = await readFile(resolve("public/reset-password/index.html"), "utf8");
  await page.route("**/confirmed", route => route.fulfill({ contentType: "text/html", body: html }));
  await page.route("**/reset-password", route => route.fulfill({ contentType: "text/html", body: reset }));
  await page.goto("/confirmed#access_token=recovery-token&type=recovery");
  await expect(page).toHaveURL(/\/reset-password$/);
  await expect(page.locator("#reset-form")).toBeVisible();
});

test("shared profile reads only public JSON and hides a revoked profile", async ({ page }) => {
  const html = await readFile(resolve("public/p/index.html"), "utf8");
  await page.route(`**/p/${token}`, (route) => route.fulfill({ contentType: "text/html", body: html }));
  let requestHeaders: Record<string, string> = {};
  await page.route(`${config.apiUrl}/v1/public-profiles/${token}`, (route) => {
    requestHeaders = route.request().headers();
    return route.fulfill({
      contentType: "application/json",
      headers: { "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ display_name: "<private?>", achievements: [], current_streak: 3 }),
    });
  });
  await page.goto(`/p/${token}`);
  await expect(page.locator("#name")).toHaveText("<private?>");
  expect(requestHeaders.authorization).toBeUndefined();
  await expect(page.locator("img[src*='private']")).toHaveCount(0);
  await expect(page.locator("#open-app")).toHaveAttribute("href", `com.codingmoves.oneconcept://p/${token}`);

  await page.route(`${config.apiUrl}/v1/public-profiles/${token}`, (route) =>
    route.fulfill({ status: 404, body: "{}", headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.reload();
  await expect(page.locator("#status")).toContainText("private or no longer available");
  await expect(page.locator("#name")).toHaveText("Shared profile");
});

test("recovery consumes only a recovery fragment and clears it before submission", async ({ page }) => {
  const html = await readFile(resolve("public/reset-password/index.html"), "utf8");
  await page.route("**/reset-password", (route) => route.fulfill({ contentType: "text/html", body: html }));
  let authHeader = "";
  await page.route(`${config.supabaseUrl}/auth/v1/user`, (route) => {
    authHeader = route.request().headers().authorization;
    return route.fulfill({ contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*" }, body: "{}" });
  });
  await page.goto("/reset-password#access_token=test-recovery-token&type=recovery");
  await expect(page).toHaveURL(/\/reset-password$/);
  await page.locator("#password").fill("new-password-123");
  await page.locator("#confirm-password").fill("new-password-123");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.locator("#status")).toContainText("Password updated");
  expect(authHeader).toBe("Bearer test-recovery-token");

  await page.goto("/");
  await page.goto("/reset-password#access_token=wrong-type&type=signup");
  await expect(page.locator("#reset-form")).toBeHidden();
  await expect(page.locator("#status")).toContainText("invalid or has expired");
});
