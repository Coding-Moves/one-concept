import { test, expect } from "@playwright/test";
import { fixture, login } from "./fixture";

for (const [role, caps] of [
  ["owner", ["review", "approve", "publish", "manage_reviewers"]],
  ["reviewer", ["review"]],
] as const) {
  test(`${role} can choose password-only sign-in and restore the authenticator`, async ({ page, context }) => {
    const state = await fixture(context, { caps: [...caps], mfa: true });
    await login(page);
    await expect(page.getByRole("heading", { name: "Verify your authenticator" })).toBeVisible();
    await page.getByLabel("Six-digit code").fill("123456");
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await expect(page.getByRole("heading", { name: "A little care. Better learning." })).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const toggle = page.getByRole("switch", { name: "Require authenticator" });
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(page.getByText("Your authenticator stays enrolled", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await page.getByLabel("Current six-digit code").fill("123456");
    await page.getByRole("button", { name: "Confirm and turn off" }).click();
    await expect(toggle).not.toBeChecked();
    expect(state.member.require_mfa).toBe(false);
    expect(state.challenges).toBe(2);
    state.mfa = true; // A later password-only session returns AAL1.
    await page.getByRole("button", { name: "Sign out" }).click();
    await login(page);
    await expect(page.getByRole("heading", { name: "A little care. Better learning." })).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(toggle).not.toBeChecked();
    await toggle.click();
    await expect(toggle).toBeChecked();
    expect(state.member.require_mfa).toBe(true);
    await page.getByRole("button", { name: "Review queue" }).click();
    await expect(page.getByRole("heading", { name: "Verify your authenticator" })).toBeVisible();
  });
}
