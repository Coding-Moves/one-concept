import { test, expect } from "@playwright/test";
import { fixture, login, openLesson, checkAll, rid, cid } from "./fixture";

test("approval is disabled while a manual correction is open", async ({
  page,
  context,
}) => {
  await fixture(context);
  await login(page);
  await openLesson(page);
  await checkAll(page);
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await expect(
    page.getByRole("button", { name: "Approve and publish" }),
  ).toBeDisabled();
});
test("changes-requested revisions require a new correction instead of invalid resubmission", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await page
    .getByLabel("Review note or comment")
    .fill("The example needs a source and a clearer sequence.");
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Request AI correction" }),
  ).toBeVisible();
  expect(state.status).toBe("changes_requested");
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toHaveCount(0);
});
