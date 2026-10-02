import { test, expect } from "@playwright/test";
import { fixture, login, openLesson } from "./fixture";

test("background queue refresh preserves keyboard focus", async ({
  page,
  context,
}) => {
  await page.clock.install();
  await fixture(context);
  await login(page);
  const row = page
    .getByRole("button")
    .filter({ has: page.getByText("Database Migrations", { exact: true }) });
  await row.focus();
  await expect(row).toBeFocused();
  const refreshed = page.waitForResponse((r) =>
    r.url().includes("/editorial/queue?"),
  );
  await page.clock.fastForward(30000);
  await refreshed;
  await expect(row).toBeFocused();
});

test("a temporary access-refresh outage preserves the reviewer feedback", async ({
  page,
  context,
}) => {
  await fixture(context);
  await login(page);
  await openLesson(page);
  await page
    .getByLabel("Review note or comment")
    .fill("Unsent feedback must survive a temporary network failure.");
  let status = 503;
  await context.route("http://127.0.0.1:8000/v1/editorial/me", (r) =>
    r.fulfill({
      status,
      json: { detail: "Unavailable" },
      headers: { "access-control-allow-origin": "*" },
    }),
  );
  const response = page.waitForResponse(
    (r) => r.url().endsWith("/editorial/me") && r.status() === 503,
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await response;
  await expect(page.getByLabel("Review note or comment")).toHaveValue(
    "Unsent feedback must survive a temporary network failure.",
  );
  status = 403;
  await page.getByRole("button", { name: "Retry account check" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace unavailable" }),
  ).toBeVisible();
  await expect(page.getByLabel("Review note or comment")).toHaveCount(0);
  await expect(
    page.getByText("Database Migrations", { exact: true }),
  ).toHaveCount(0);
});
