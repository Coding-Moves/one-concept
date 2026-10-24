import { test, expect } from "@playwright/test";
import { fixture, login } from "./fixture";

test("a first-time reviewer can use the workspace with authenticator off", async ({
  page,
  context,
}) => {
  await fixture(context, { caps: ["review"], requireMfa: false, mfa: true });
  await login(page);
  await expect(page.getByRole("heading", { name: "A little care. Better learning." })).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByRole("switch", { name: "Require authenticator" })).not.toBeChecked();
});

test("owner confirms permanent reviewer removal and the account leaves the list", async ({
  page,
  context,
}) => {
  const state = await fixture(context, { requireMfa: false });
  const reviewerId = "10000000-0000-4000-8000-000000000002";
  state.members.push({ ...state.member, user_id: reviewerId,
    invited_email: "peer@example.test", requested_name: "Peer Reviewer",
    approved_name: "Peer Reviewer", capabilities: ["review"], version: 2 });
  await login(page);
  await page.getByRole("button", { name: "Reviewers", exact: true }).click();
  const row = page.locator("details.member").filter({ hasText: "peer@example.test" });
  await row.locator("summary").click();
  page.once("dialog", async (dialog) => {
    expect(dialog.message()).toContain("learning account and past review history will remain");
    await dialog.accept();
  });
  await row.getByRole("button", { name: "Permanently remove reviewer" }).click();
  await expect(page.getByText("peer@example.test")).toHaveCount(0);
  expect(state.members).toHaveLength(1);
});
