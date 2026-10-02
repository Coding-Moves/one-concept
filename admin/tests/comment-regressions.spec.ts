import { test, expect } from "@playwright/test";
import { fixture, login, openLesson } from "./fixture";
test("a comment on published content does not claim a new publication", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.status = "published";
  state.approvedBy = "Amina Khan";
  await login(page);
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await openLesson(page);
  await page
    .getByLabel("Review note or comment")
    .fill("The published example is helpful and clearly explained.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Comment saved.", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Published successfully", { exact: false }),
  ).toHaveCount(0);
});
