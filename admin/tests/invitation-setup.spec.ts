import { test, expect } from "@playwright/test";
import { fixture, login } from "./fixture";

test("a direct callback without a verified email link cannot open account setup", async ({ page, context }) => {
  await fixture(context);
  await page.goto("/auth/callback");
  await expect(page.getByText("Open your invitation or recovery link from the email", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish creating your account" })).toHaveCount(0);
});

test("an incomplete email return removes its credential fragment and stays on sign in", async ({ page, context }) => {
  await fixture(context);
  await page.goto("/auth/callback#access_token=partial-secret&type=invite");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByText("This sign-in link has expired or could not be verified.")).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
});

test("a verified invitation opens dedicated setup for the shared learning and review account", async ({ page, context }) => {
  await fixture(context, { onboarding: true, requireMfa: false });
  await login(page);
  await expect(page.getByRole("heading", { name: "Let’s set up your reviewer profile" })).toBeVisible();
  const tokens = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("one-concept-review-auth") || "null");
    return { access: session.access_token as string, refresh: session.refresh_token as string };
  });
  await page.goto(`/auth/callback#access_token=${encodeURIComponent(tokens.access)}&refresh_token=${encodeURIComponent(tokens.refresh)}&type=invite`);
  await expect(page.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();
  await expect(page.getByLabel("Verified email")).toHaveValue("reviewer@example.test");
  await expect(page).toHaveURL(/\/auth\/callback$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Finish creating your account" })).toBeVisible();
  await expect(page.getByLabel("Verified email")).toHaveValue("reviewer@example.test");
  await page.getByLabel("Password", { exact: true }).fill("new-private-password");
  await page.getByLabel("Confirm password").fill("different-password");
  await page.getByRole("button", { name: "Save password and continue" }).click();
  await expect(page.getByText("The passwords do not match.")).toBeVisible();
  await page.getByLabel("Confirm password").fill("new-private-password");
  await page.getByRole("button", { name: "Save password and continue" }).click();
  await expect(page.getByRole("heading", { name: "Let’s set up your reviewer profile" })).toBeVisible();
  await expect(page).toHaveURL(/\?view=queue$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Finish creating your account" })).toHaveCount(0);
});

test("a recovery email returns to the same password setup without creating a second account", async ({ page, context }) => {
  await fixture(context);
  await login(page);
  await expect(page.getByRole("heading", { name: "A little care. Better learning." })).toBeVisible();
  const tokens = await page.evaluate(() => {
    const session = JSON.parse(localStorage.getItem("one-concept-review-auth") || "null");
    return { access: session.access_token as string, refresh: session.refresh_token as string };
  });
  await page.goto(`/auth/callback#access_token=${encodeURIComponent(tokens.access)}&refresh_token=${encodeURIComponent(tokens.refresh)}&type=recovery`);
  await expect(page.getByRole("heading", { name: "Set your password" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Finish creating your account" })).toHaveCount(0);
});
