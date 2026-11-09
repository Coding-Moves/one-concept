import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fixture, login } from "./fixture";

test("a learner recovery link verifies MFA before updating the password", async ({ page, context }) => {
  await fixture(context, { mfa: true, requireMfa: false });
  await login(page);
  await page.waitForFunction(() => !!localStorage.getItem("one-concept-review-auth"));
  const tokens = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("one-concept-review-auth") || "null");
    return { access: session.access_token as string, refresh: session.refresh_token as string };
  });
  await page.route("**/account/callback**", route => route.fulfill({
    status: 200,
    contentType: "text/html",
    body: readFileSync(new URL("../account.html", import.meta.url), "utf8"),
  }));
  await page.goto(`/account/callback#access_token=${encodeURIComponent(tokens.access)}&refresh_token=${encodeURIComponent(tokens.refresh)}&type=recovery`);
  await expect(page.getByRole("heading", { name: "Set a new password" })).toBeVisible();
  await page.getByLabel("New password").fill("new-private-password");
  await page.getByLabel("Confirm password").fill("new-private-password");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByLabel("Current six-digit code")).toBeVisible();
  await page.getByLabel("Current six-digit code").fill("123456");
  await page.getByRole("button", { name: "Update password" }).click();
  await expect(page.getByText("Password updated. Sign in with your new password.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
});
