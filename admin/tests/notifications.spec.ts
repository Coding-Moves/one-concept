import { test, expect } from "@playwright/test";
import { fixture, login } from "./fixture";

test("owner sees overdue work, changes policy and safely queues a retry", async ({ page, context }) => {
  await fixture(context);
  let version = 1, max = 2, status = "failed", retried = false;
  await context.route("**/v1/editorial/notifications**", async route => {
    const req = route.request(), path = new URL(req.url()).pathname;
    const json = (value: unknown, code = 200) => route.fulfill({ status: code, contentType: "application/json", body: JSON.stringify(value) });
    if (path.endsWith("/policy")) {
      const body = req.postDataJSON();
      expect(body.expected_version).toBe(version);
      max = body.max_reminders; version++;
      return json({ version, deadline_hours: 48, reminder_hours: 24, max_reminders: max });
    }
    if (path.endsWith("/retry")) { expect(req.postDataJSON().expected_version).toBe(1); retried = true; status = "pending"; return json({ status }); }
    return json({ policy: { version, deadline_hours: 48, reminder_hours: 24, max_reminders: max }, setup_status: "ready", daily_cap: 40, attempts_last_24h: 1, overdue: 3,
      counts: { [status]: 1 }, items: [{ id: "batch-fixture", status, recipient_name: "Amina Khan", attempts: 1, failure_code: "sender_authorization", created_at: "2026-10-02T00:00:00Z" }], next_cursor: null });
  });
  await login(page);
  await page.getByRole("button", { name: "Notifications", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Reviewer notifications" })).toBeVisible();
  await expect(page.getByText("3 overdue lessons", { exact: true })).toBeVisible();
  await page.getByLabel("Maximum reminders").fill("0");
  await page.getByRole("button", { name: "Save review policy" }).click();
  await expect(page.getByText("Review policy saved.")).toBeVisible();
  expect(max).toBe(0);
  await page.getByRole("button", { name: "Queue retry" }).click();
  await expect(page.getByText("Retry queued.", { exact: false })).toBeVisible();
  expect(retried).toBe(true);
  await page.screenshot({ path: "/tmp/one-concept-notifications-light.png", fullPage: true, animations: "disabled" });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: "/tmp/one-concept-notifications-dark-mobile.png", fullPage: true, animations: "disabled" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("reviewer cannot see owner delivery controls and can save a timezone", async ({ page, context }) => {
  const state = await fixture(context);
  state.member.capabilities = ["review"];
  Object.assign(state.member, { notification_timezone: "UTC" });
  await context.route("**/v1/editorial/me/notification-timezone", async route => {
    const body = route.request().postDataJSON();
    expect(body.timezone).toBe("Asia/Karachi");
    Object.assign(state.member, { notification_timezone: body.timezone, version: state.member.version + 1 });
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(state.member) });
  });
  await login(page);
  await expect(page.getByRole("button", { name: "Notifications", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("IANA timezone").fill("Asia/Karachi");
  await page.getByRole("button", { name: "Save timezone" }).click();
  await expect(page.getByLabel("IANA timezone")).toHaveValue("Asia/Karachi");
  await page.reload();
  await expect(page.getByLabel("IANA timezone")).toHaveValue("Asia/Karachi");
});
