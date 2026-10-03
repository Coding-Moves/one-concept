import { test, expect } from "@playwright/test";
import { fixture, login } from "./fixture";
import {
  demoOverview,
  demoOperations,
  demoReviewers,
  ownerDemoApi,
} from "../src/ownerDemo";

async function reports(context: any) {
  const state = { fail: false, denied: false, old: false };
  await context.route("**/v1/editorial/owner/**", async (route: any) => {
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 200,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-headers": "*",
        },
      });
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/v1/editorial", "");
    let data: any;
    if (path === "/owner/overview")
      data = demoOverview(
        url.searchParams.get("start")!,
        url.searchParams.get("end")!,
      );
    else if (path === "/owner/operations")
      data = structuredClone(demoOperations);
    else if (path === "/owner/reviewers")
      data = { items: demoReviewers, next_cursor: null };
    else data = await ownerDemoApi.request(path + url.search);
    data.observed_at = state.old
      ? "2000-01-01T00:00:00Z"
      : new Date().toISOString();
    await route.fulfill({
      status: state.denied ? 403 : state.fail ? 503 : 200,
      contentType: "application/json",
      headers: { "access-control-allow-origin": "*" },
      body: JSON.stringify(
        state.fail || state.denied ? { detail: "Unavailable" } : data,
      ),
    });
  });
  return state;
}
for (const theme of ["light", "dark"]) {
  test(`owner dashboard ${theme}: reports, keyboard, filters and responsive layout`, async ({
    context,
    page,
  }) => {
    await fixture(context);
    await reports(context);
    await login(page);
    await page
      .getByRole("button", { name: "Owner dashboard", exact: false })
      .click();
    await expect(
      page.getByRole("heading", { name: "Your learning community" }),
    ).toBeVisible();
    await expect(page.getByText("1,248", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open review queue" }),
    ).toBeVisible();
    if (theme === "dark")
      await page.getByRole("button", { name: "Use dark theme" }).click();
    await page.screenshot({
      path: `/tmp/owner-overview-${theme}.png`,
      fullPage: true,
    });
    await page.getByText("View activity as a table", { exact: true }).click();
    await expect(
      page.getByRole("table", { name: "Daily learning activity" }),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Owner reports" })
      .getByRole("button", { name: "Reviewers", exact: true })
      .click();
    await expect(
      page.getByRole("table", { name: "Reviewer contributions" }),
    ).toBeVisible();
    await expect(page.getByText("Amina Shah", { exact: true })).toBeVisible();
    await page
      .getByRole("navigation", { name: "Owner reports" })
      .getByRole("button", { name: "Operations" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Last worker observations" }),
    ).toBeVisible();
    await expect(page.getByText("Stale", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Generation (API configuration)", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/worker settings can differ and are not read here/),
    ).toBeVisible();
    await page
      .getByRole("navigation", { name: "Owner reports" })
      .getByRole("button", { name: "Events" })
      .click();
    await page.getByLabel("Search status code").fill("missing");
    await page.getByRole("button", { name: "Apply event filters" }).click();
    await expect(
      page.getByText("No events match these filters."),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("navigation", { name: "Owner reports" })
      .getByRole("button", { name: "Overview" })
      .click();
    await expect(page.getByText("1,248", { exact: true })).toBeVisible();
    await page.screenshot({
      path: `/tmp/owner-mobile-${theme}.png`,
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page
      .getByRole("button", { name: "Apply dates", exact: true })
      .focus();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Refresh reports" }),
    ).toBeFocused();
  });
}
test("demo never contacts Auth or API, including with an existing session", async ({
  context,
  page,
}) => {
  const external: string[] = [];
  await context.addInitScript(() =>
    localStorage.setItem(
      "one-concept-review-auth",
      JSON.stringify({ access_token: "must-not-use", user: { id: "private" } }),
    ),
  );
  page.on("request", (r) => {
    if (!r.url().startsWith("http://127.0.0.1:4173")) external.push(r.url());
  });
  await page.goto(
    "/?demo=owner#access_token=synthetic-unused&refresh_token=synthetic-unused",
  );
  await expect(page.getByText("DEMO · SYNTHETIC DATA")).toBeVisible();
  await expect(page.getByText("1,248", { exact: true })).toBeVisible();
  for (const name of ["Reviewers", "Operations", "Events"])
    await page
      .getByRole("navigation", { name: "Owner reports" })
      .getByRole("button", { name, exact: true })
      .click();
  await expect(
    page.getByRole("table", { name: "Operational events" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Next events" }).click();
  await expect(page.getByText("Page 2", { exact: true })).toBeVisible();
  await page.getByLabel("Severity", { exact: true }).selectOption("error");
  await page.getByRole("button", { name: "Apply event filters" }).click();
  await expect(page.getByText("Page 1", { exact: true })).toBeVisible();
  expect(external).toEqual([]);
});
test("ordinary reviewers cannot navigate to owner reporting", async ({
  context,
  page,
}) => {
  await fixture(context, { caps: ["review"] });
  let calls = 0;
  page.on("request", (r) => {
    if (r.url().includes("/owner/")) calls++;
  });
  await login(page);
  await page.goto("/?view=owner");
  await expect(
    page.getByRole("button", { name: "Owner dashboard" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Your learning community" }),
  ).toHaveCount(0);
  expect(calls).toBe(0);
});
test("failed refresh is explicit and revocation clears privileged data", async ({
  context,
  page,
}) => {
  await fixture(context);
  const state = await reports(context);
  await login(page);
  await page.getByRole("button", { name: "Owner dashboard" }).click();
  await expect(page.getByText("1,248", { exact: true })).toBeVisible();
  state.fail = true;
  await page.getByRole("button", { name: "Refresh reports" }).click();
  await expect(page.getByText(/Showing the last observation/)).toBeVisible();
  await expect(page.getByText("1,248", { exact: true })).toBeVisible();
  state.fail = false;
  state.denied = true;
  await page.getByRole("button", { name: "Refresh reports" }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("1,248", { exact: true })).toHaveCount(0);
});
test("first load failure does not invent zero metrics and sign-out fences late reports", async ({
  context,
  page,
}) => {
  await fixture(context);
  const state = await reports(context);
  state.fail = true;
  await login(page);
  await page.getByRole("button", { name: "Owner dashboard" }).click();
  await expect(page.getByText(/Report unavailable/)).toBeVisible();
  await expect(
    page.getByText("Registered learners", { exact: true }),
  ).toHaveCount(0);
  let release: () => void = () => {};
  const held = new Promise<void>((r) => (release = r));
  await context.route("**/v1/editorial/owner/overview?**", async (route) => {
    await held;
    await route.fulfill({
      json: demoOverview(),
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await page.getByRole("button", { name: "Refresh reports" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  release();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("1,248", { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      Object.values(localStorage).some((x) => x.includes('"registered":1248')),
    ),
  ).toBe(false);
});

test("event filters accept public incident IDs and canonical UUIDs", async ({
  context,
  page,
}) => {
  await fixture(context);
  await reports(context);
  await login(page);
  await page.getByRole("button", { name: "Owner dashboard" }).click();
  await page
    .getByRole("navigation", { name: "Owner reports" })
    .getByRole("button", { name: "Events" })
    .click();
  for (const incident of [
    "123456781234423482341234567890ab",
    "12345678-1234-4234-8234-1234567890ab",
  ]) {
    await page.getByLabel("Correlation ID", { exact: true }).fill(incident);
    const request = page.waitForRequest(
      (r) =>
        r.method() === "GET" &&
        new URL(r.url()).searchParams.get("correlation") === incident,
    );
    await page.getByRole("button", { name: "Apply event filters" }).click();
    await request;
    await expect(
      page.getByText("No events match these filters."),
    ).toBeVisible();
  }
  await page
    .getByLabel("Correlation ID", { exact: true })
    .fill("not-an-incident");
  expect(
    await page
      .getByLabel("Correlation ID", { exact: true })
      .evaluate((el: HTMLInputElement) => el.checkValidity()),
  ).toBe(false);
});

test("account administrators without review permission keep reporting and team access", async ({
  context,
  page,
}) => {
  await fixture(context, { caps: ["manage_reviewers"] });
  await reports(context);
  await login(page);
  await page.getByRole("button", { name: "Owner dashboard" }).click();
  await expect(page.getByText("1,248", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open review queue" }),
  ).toHaveCount(0);
  await page
    .getByRole("navigation", { name: "Owner reports" })
    .getByRole("button", { name: "Reviewers", exact: true })
    .click();
  await page.getByRole("button", { name: "Manage reviewers" }).click();
  await expect(
    page.getByRole("heading", { name: "Reviewer accounts" }),
  ).toBeVisible();
});
