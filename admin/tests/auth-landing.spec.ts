import { expect, test, type Page } from "@playwright/test";
import { publicPage } from "../../supabase/functions/api/public_pages.ts";

const origin = "https://one-concept.supabase.co";
const base = `${origin}/functions/v1/api`;
const config = { supabaseUrl: origin, anonKey: "public-anon-key" };

async function serveAuthPages(page: Page) {
  await page.route(`${base}/**`, async route => {
    const url = new URL(route.request().url());
    const response = publicPage(url.pathname.slice("/functions/v1/api".length), "GET", config, new Headers());
    if (!response) return route.fulfill({ status: 404, body: "Not found" });
    return route.fulfill({
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body: await response.text(),
    });
  });
}

test("direct confirmation visit does not claim that an email was verified", async ({ page }) => {
  await serveAuthPages(page);
  await page.goto(`${base}/confirmed`);
  await expect(page.getByRole("heading", { name: "Check your email link" })).toBeVisible();
  await expect(page.getByText("Email confirmed ✓")).toHaveCount(0);
  await expect(page).toHaveTitle("One Concept — email confirmation");
});

test("verified confirmation link reports success and removes its session fragment", async ({ page }) => {
  await serveAuthPages(page);
  await page.goto(`${base}/confirmed#access_token=confirmed-token&type=signup`);
  await expect(page.getByRole("heading", { name: "Email confirmed ✓" })).toBeVisible();
  await expect(page).toHaveURL(`${base}/confirmed`);
});

test("expired confirmation link reports the error without claiming success", async ({ page }) => {
  await serveAuthPages(page);
  await page.goto(`${base}/confirmed#error=access_denied&error_description=Email%20link%20expired`);
  await expect(page.getByRole("heading", { name: "Confirmation did not finish" })).toBeVisible();
  await expect(page.getByText("Email link expired")).toBeVisible();
  await expect(page).toHaveURL(`${base}/confirmed`);
});

test("recovery link reaches the reset form and updates the password with its token", async ({ page }) => {
  await serveAuthPages(page);
  let authRequest: { method: string; authorization: string | undefined; apikey: string | undefined; password: string } | undefined;
  await page.route(`${origin}/auth/v1/user`, async route => {
    authRequest = {
      method: route.request().method(),
      authorization: route.request().headers().authorization,
      apikey: route.request().headers().apikey,
      password: route.request().postDataJSON().password,
    };
    await route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.goto(`${base}/confirmed#access_token=recovery-token&type=recovery`);
  await expect(page).toHaveURL(`${base}/reset-password`);
  await page.getByLabel("New password", { exact: true }).fill("safe-new-password");
  await page.getByLabel("Confirm new password").fill("safe-new-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByRole("alert")).toContainText("Password updated");
  expect(authRequest).toEqual({
    method: "PUT",
    authorization: "Bearer recovery-token",
    apikey: "public-anon-key",
    password: "safe-new-password",
  });
});

test("expired recovery link shows an error and never calls Auth", async ({ page }) => {
  await serveAuthPages(page);
  let called = false;
  await page.route(`${origin}/auth/v1/user`, async route => {
    called = true;
    await route.fulfill({ status: 500, body: "Unexpected request" });
  });
  await page.goto(`${base}/reset-password#error=access_denied&error_description=Email%20link%20expired`);
  await expect(page.getByRole("alert")).toHaveText("Email link expired");
  await expect(page.getByRole("button", { name: "Update password" })).toBeHidden();
  await expect(page).toHaveURL(`${base}/reset-password`);
  expect(called).toBe(false);
});
