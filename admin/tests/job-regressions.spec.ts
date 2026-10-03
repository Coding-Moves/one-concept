import { test, expect } from "@playwright/test";
import { fixture, login, openLesson, rid, cid } from "./fixture";
test("reloading refreshes AI jobs even when the source token has not changed", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.jobs = [
    {
      id: rid,
      concept_id: cid,
      source_revision_id: rid,
      status: "pending",
      attempts: 0,
      token: state.token,
    },
  ];
  await login(page);
  await openLesson(page);
  await expect(
    page.getByRole("button", { name: "Cancel AI request" }),
  ).toBeVisible();
  state.jobs[0] = {
    ...state.jobs[0],
    status: "ready_for_review",
    result_revision_id: rid,
  };
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open corrected draft" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel AI request" }),
  ).toHaveCount(0);
});
