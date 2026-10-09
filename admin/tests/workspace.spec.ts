import { test, expect } from "@playwright/test";
import { fixture, login, openLesson, checkAll, rid, cid, tid } from "./fixture";
test("topic filtering, full package, comments and atomic publication", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
  await page
    .getByLabel("Topic", { exact: true })
    .selectOption({ label: "Software Engineering" });
  await page
    .getByLabel("Subtopic", { exact: true })
    .selectOption({ label: "Databases" });
  await openLesson(page);
  await expect(page.getByRole("heading", { name: "Question 3" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Approve and publish" }),
  ).toBeDisabled();
  await page
    .getByLabel("Review note or comment")
    .fill("Please check the rollout order with the linked documentation.");
  await page.getByRole("button", { name: "Add comment", exact: true }).click();
  await expect(page.getByText("Comment saved.")).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByText(
      "Please check the rollout order with the linked documentation.",
    ),
  ).toBeVisible();
  await checkAll(page);
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(
    page.getByText("Published successfully", { exact: false }),
  ).toBeVisible();
  expect(state.status).toBe("published");
  await expect(
    page.getByRole("button", { name: "Approve and publish" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await expect(
    page.getByText("Approved by Amina Khan", { exact: false }),
  ).toBeVisible();
});
test("a published revision remains a structured, readable history entry", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await checkAll(page);
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(page.getByText("Published successfully", { exact: false })).toBeVisible();
  expect(state.contentVersion).toBeGreaterThan(state.baseVersion);
  await page.getByRole("button", { name: "Published", exact: true }).click();
  await openLesson(page);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: /Revision #/ }).click();
  await expect(page.getByText("BASE VERSION 1", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Lesson", exact: true }).click();
  await expect(page.locator(".lesson-document")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Worked example" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Question 3" })).toBeVisible();
  await expect(page.locator(".document-card pre.plain-value")).toHaveCount(0);
  await expect(page.getByText("Revision is stale", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Changes from the original lesson" })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Comments & decisions" })).toBeVisible();
  await expect(page.getByText("Published", { exact: true }).last()).toBeVisible();
});
test("approval and publication roles can complete their separate handoff", async ({
  page,
  context,
}) => {
  const state = await fixture(context, { caps: ["approve"] });
  await login(page);
  await openLesson(page);
  await expect(page.getByRole("button", { name: "Approve revision" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add comment" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Prepare manual correction" })).toHaveCount(0);
  await checkAll(page);
  await page.getByRole("button", { name: "Approve revision" }).click();
  await expect(page.getByText("Approved for the whole team", { exact: false })).toBeVisible();
  expect(state.status).toBe("approved");
});
test("publication-only access opens the approved queue and publishes", async ({
  page,
  context,
}) => {
  const state = await fixture(context, { caps: ["publish"] });
  state.status = "approved";
  state.approvedBy = "Amina Khan";
  await login(page);
  await page.getByRole("button", { name: "Approved", exact: true }).click();
  await openLesson(page);
  await expect(page.getByRole("button", { name: "Publish approved revision" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add comment" })).toHaveCount(0);
  await page.getByLabel("Review note or comment").fill("Publishing the already approved revision.");
  await page.getByRole("button", { name: "Publish approved revision" }).click();
  await expect(page.getByText("Published successfully", { exact: false })).toBeVisible();
  expect(state.status).toBe("published");
});
test("owner and reviewer sessions see one assignment, comment and publication", async ({
  page,
  context,
  browser,
}) => {
  const state = await fixture(context);
  const reviewerId = "00000000-0000-4000-8000-000000000002";
  const reviewerEmail = "second-reviewer@example.test";
  state.members.push({
    ...state.member,
    user_id: reviewerId,
    invited_email: reviewerEmail,
    approved_name: "Second Reviewer",
    requested_name: "Second Reviewer",
    capabilities: ["review"],
  });
  await login(page);
  await openLesson(page);
  await page.getByLabel("Assign to", { exact: true }).selectOption(reviewerId);
  await page.getByLabel("Review note or comment").fill(
    "Please review the whole lesson and its reference.",
  );
  await page.getByRole("button", { name: "Save assignment" }).click();
  await expect(page.getByText("Assignment saved.")).toBeVisible();
  expect(state.assignedTo).toBe(reviewerId);

  const reviewerContext = await browser.newContext();
  try {
    await fixture(reviewerContext, {
      caps: ["review"],
      userId: reviewerId,
      email: reviewerEmail,
      name: "Second Reviewer",
      shared: state,
    });
    const reviewerPage = await reviewerContext.newPage();
    await login(reviewerPage, reviewerEmail);
    await openLesson(reviewerPage);
    await expect(reviewerPage.getByRole("button", { name: "Save assignment" })).toHaveCount(0);
    await reviewerPage.getByLabel("Review note or comment").fill(
      "The example and all three questions match the reference.",
    );
    await reviewerPage.getByRole("button", { name: "Add comment" }).click();
    await expect(reviewerPage.getByText("Comment saved.")).toBeVisible();

    await page.getByRole("button", { name: "Reload", exact: true }).click();
    await page.getByRole("button", { name: "History", exact: true }).click();
    await expect(page.getByText("The example and all three questions match the reference.")).toBeVisible();
    await checkAll(page);
    await page.getByRole("button", { name: "Approve and publish" }).click();
    await expect(page.getByText("Published successfully", { exact: false })).toBeVisible();

    await reviewerPage.getByRole("button", { name: "Reload", exact: true }).click();
    await expect(reviewerPage.getByText("Published", { exact: true }).first()).toBeVisible();
    await reviewerPage.getByRole("button", { name: "Lesson", exact: true }).click();
    await expect(reviewerPage.getByRole("heading", { name: "Question 3" })).toBeVisible();
    expect(state.contentVersion).toBe(2);
  } finally {
    await reviewerContext.close();
  }
});
test("second tab cannot repeat a shared approval; feedback survives conflict", async ({
  page,
  context,
}) => {
  await fixture(context);
  await login(page);
  await openLesson(page);
  const other = await context.newPage();
  await other.goto("/?view=review&kind=revisions&id=" + rid);
  await expect(
    other.getByRole("heading", { name: "Review this lesson" }),
  ).toBeVisible();
  await checkAll(page);
  await checkAll(other);
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(
    page.getByText("Published successfully", { exact: false }),
  ).toBeVisible();
  await other.getByRole("button", { name: "Approve and publish" }).click();
  await expect(
    other.getByText("Your feedback is preserved.", { exact: false }),
  ).toBeVisible();
  await expect(other.getByLabel("Review note or comment")).not.toBeEmpty();
  await other.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(
    other.getByRole("button", { name: "Approve and publish" }),
  ).toHaveCount(0);
  await expect(
    other.getByText("Approved by Amina Khan.", { exact: false }),
  ).toBeVisible();
});
test("change request, diff, AI correction status and manual revision", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await page.getByRole("button", { name: "Changes", exact: true }).click();
  await expect(
    page.getByText("Previous explanation.", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Review note or comment")
    .fill("Explain why adding the constraint first could fail.");
  await page
    .getByRole("button", { name: "Request changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Request AI correction" }),
  ).toBeVisible();
  await page
    .getByLabel("Review note or comment")
    .fill("Use the recorded feedback to prepare a clearer example.");
  await page.getByRole("button", { name: "Request AI correction" }).click();
  await expect(
    page.getByText("AI correction queued.", { exact: false }),
  ).toBeVisible();
  expect(state.jobs).toHaveLength(1);
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await page
    .getByLabel("Explanation", { exact: true })
    .fill("A carefully updated explanation with clear deployment order.");
  await page
    .getByLabel("Review note or comment")
    .fill("Prepared a manual explanation of the deployment order.");
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toBeVisible();
  expect(state.body.summary).toContain("carefully updated");
});
test("uncertain publication retries the same operation without duplicate approval", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await checkAll(page);
  state.uncertain = true;
  await page.getByRole("button", { name: "Approve and publish" }).click();
  await expect(
    page.getByRole("button", { name: "Retry identical request" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Retry identical request" }).click();
  await expect(
    page.getByText("Published successfully", { exact: false }),
  ).toBeVisible();
  expect(state.commands[0].request_id).toBe(state.commands[1].request_id);
  expect(state.events).toHaveLength(1);
});
test("review-only permissions, rejection and session expiry", async ({
  page,
  context,
}) => {
  const state = await fixture(context, { caps: ["review"] });
  await login(page);
  await openLesson(page);
  await expect(
    page.getByRole("button", { name: "Approve and publish" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Reviewers", exact: true }),
  ).toHaveCount(0);
  await page
    .getByLabel("Review note or comment")
    .fill("This draft needs a replacement source and factual correction.");
  await page.getByRole("button", { name: "Reject revision" }).click();
  await expect(page.getByText("Saved successfully.")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Reload", exact: true }),
  ).toBeEnabled();
  expect(state.status).toBe("rejected");
  await expect(
    page.getByRole("button", { name: "Submit for review" }),
  ).toHaveCount(0);
  state.expired = true;
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign in", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your session expired. Sign in again."),
  ).toBeVisible();
  await expect(
    page.getByText("Database Migrations", { exact: true }),
  ).toHaveCount(0);
});
test("denied access reveals no queue and recovery stays generic", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.denied = true;
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Workspace unavailable" }),
  ).toBeVisible();
  await expect(page.getByText("Database Migrations")).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.getByRole("button", { name: "Forgot your password?" }).click();
  await page.getByLabel("Email address").fill("reviewer@example.test");
  await page.getByRole("button", { name: "Send recovery email" }).click();
  await expect(
    page.getByText("If this address can recover an account", { exact: false }),
  ).toBeVisible();
});
test("account access can recover after a temporary permission denial", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.denied = true;
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Workspace unavailable" }),
  ).toBeVisible();
  state.denied = false;
  await page.getByRole("button", { name: "Refresh account access" }).click();
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
});
test("onboarding form waits for name approval", async ({ page, context }) => {
  await fixture(context, { onboarding: true });
  await login(page);
  await page.getByLabel("Registered name").fill("Amina Khan");
  await page.getByRole("button", { name: "Submit name for approval" }).click();
  await expect(
    page.getByText("Your name is waiting for an administrator", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText("Database Migrations")).toHaveCount(0);
});
test("authenticator challenge gates review access", async ({
  page,
  context,
}) => {
  await fixture(context, { mfa: true });
  await login(page);
  await expect(
    page.getByRole("heading", { name: "Verify your authenticator" }),
  ).toBeVisible();
  await page.getByLabel("Six-digit code").fill("123456");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
});
test("unsent feedback warns before navigation; sign-out clears it", async ({
  page,
  context,
}) => {
  await fixture(context);
  await login(page);
  await openLesson(page);
  await page
    .getByLabel("Review note or comment")
    .fill("Private unfinished feedback");
  page.once("dialog", (d) => d.dismiss());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByLabel("Review note or comment")).toHaveValue(
    "Private unfinished feedback",
  );
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByLabel("Review note or comment")).toHaveCount(0);
});
test("desktop and narrow themes retain readable controls without overflow", async ({
  page,
  context,
}) => {
  await fixture(context);
  await page.setViewportSize({ width: 1440, height: 1100 });
  await login(page);
  await page.screenshot({ path: "/tmp/278-queue-light.png", fullPage: true });
  await page.getByRole("button", { name: "Use dark theme" }).click();
  await openLesson(page);
  await page.screenshot({ path: "/tmp/278-review-dark.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Add comment", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "/tmp/278-review-narrow.png", fullPage: true });
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => document.activeElement?.tagName !== "BODY"),
  ).toBe(true);
});

test("owner assigns a deadline, invites a reviewer and requests bounded drafts", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await page
    .getByLabel("Assign to", { exact: true })
    .selectOption({ label: "Amina Khan" });
  await page
    .getByLabel("Review due (your local time)")
    .fill("2030-10-12T10:30");
  await page
    .getByLabel("Review note or comment")
    .fill("Please finish checking these references by the agreed deadline.");
  await page.getByRole("button", { name: "Save assignment" }).click();
  await expect(page.getByText("Assignment saved.")).toBeVisible();
  expect(state.commands[0].review_due_at).toMatch(/^2030-10-12T/);
  expect(state.commands[0].assignee_id).toBeTruthy();
  await page.getByRole("button", { name: "Reviewers", exact: true }).click();
  await page.getByLabel("Reviewer email").fill("second@example.test");
  await page
    .getByRole("button", { name: "Invite reviewer", exact: true })
    .click();
  await expect(
    page.getByText("Membership created.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "AI requests", exact: true }).click();
  await page
    .getByLabel("Topic", { exact: true })
    .selectOption({ label: "Software Engineering" });
  await expect(page.getByText("Review capacity: 3/25")).toBeVisible();
  await page
    .getByLabel("Request note")
    .fill("Prepare two planned database lessons for the team to review.");
  await page.getByLabel("Requested drafts").fill("2");
  await page
    .getByRole("button", { name: "Request drafts", exact: true })
    .click();
  await expect(
    page.getByText("Demand recorded.", { exact: false }),
  ).toBeVisible();
  expect(state.commands.at(-1).count).toBe(2);
  expect(state.commands.at(-1)).not.toHaveProperty("expected_token");
});
test("owner prepares and starts a private legacy subject batch", async ({ page, context }) => {
  await fixture(context);
  const batchId = "50000000-0000-4000-8000-000000000001";
  let batch: Record<string, unknown> | null = null;
  const actions: string[] = [];
  await page.route("**/v1/editorial/legacy-**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = request.method() === "POST" ? request.postDataJSON() : null;
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*" } });
      return;
    }
    let result: unknown;
    if (path.includes("eligibility")) {
      result = { eligible_count: 1, active_batch_id: batch ? batchId : null, configured: true };
    } else if (path.endsWith("/entries")) {
      result = { items: [{ id: "entry", concept_id: cid, title: "Database Migrations",
        status: actions.length ? "ready_for_review" : "queued",
        attempts: actions.length ? 1 : 0, failure_code: null,
        result_revision_id: actions.length ? rid : null }] };
    } else if (request.method() === "POST" && path.endsWith("/actions")) {
      actions.push(body.action);
      batch = { ...batch, status: "running", token: "next-token" };
      result = batch;
    } else if (request.method() === "POST") {
      expect(body.topic_id).toBe(tid);
      expect(body.quota_limit).toBe(3);
      batch = { id: batchId, topic_id: tid, name: body.name, status: "queued",
        discovered_count: 1, quota_limit: 3, token: "initial-token", counts: { queued: 1 } };
      result = batch;
    } else {
      result = { items: batch ? [batch] : [] };
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(result),
      headers: { "access-control-allow-origin": "*" } });
  });
  await login(page);
  await page.getByRole("button", { name: "AI requests", exact: true }).click();
  await page.getByLabel("Existing subject").selectOption(tid);
  await expect(page.getByText("1 published lessons eligible", { exact: false })).toBeVisible();
  await page.getByLabel("Maximum Gemini calls for this batch").fill("3");
  await page.getByLabel("Reason for this batch").fill("Complete the existing subject for human review.");
  await page.getByRole("button", { name: "Prepare subject batch" }).click();
  await expect(page.getByText("Batch prepared.", { exact: false })).toBeVisible();
  await page.getByLabel("Reason for batch action").fill("Begin the first bounded provider run.");
  await page.getByRole("button", { name: "Start / resume" }).click();
  await expect(page.getByText("Batch started.", { exact: true })).toBeVisible();
  expect(actions).toEqual(["resume"]);
  await page.getByRole("button", { name: "Review draft" }).click();
  await expect(page.getByRole("heading", { name: "Database Migrations", level: 1 })).toBeVisible();
});
test("assignment changes warn before navigation and exclude non-reviewers", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.members.push({
    ...state.member,
    user_id: "00000000-0000-4000-8000-000000000002",
    approved_name: "Approval Only",
    capabilities: ["approve"],
  });
  await login(page);
  await openLesson(page);
  const assignee = page.getByLabel("Assign to", { exact: true });
  await expect(assignee.locator("option", { hasText: "Approval Only" })).toHaveCount(0);
  await assignee.selectOption({ label: "Amina Khan" });
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(assignee).toHaveValue(state.member.user_id);
  await assignee.selectOption("");
  const due = page.getByLabel("Review due (your local time)");
  await due.fill("2030-10-12T10:30");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(due).toHaveValue("2030-10-12T10:30");
});
test("invitation callback clears URL credentials and allows private password setup", async ({
  page,
  context,
}) => {
  await fixture(context);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
  const session = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("one-concept-review-auth")!),
  );
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.goto(
    "/auth/callback#access_token=" +
      session.access_token +
      "&refresh_token=" +
      session.refresh_token +
      "&type=invite",
  );
  await expect(
    page.getByRole("heading", { name: "Set your password" }),
  ).toBeVisible();
  expect(new URL(page.url()).hash).toBe("");
  await page
    .getByLabel("Password", { exact: true })
    .fill("new-private-fixture-password");
  await page.getByRole("button", { name: "Save password" }).click();
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
});
test("lesson HTML stays text, unsafe references are not clickable, edits block unrelated decisions", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.body.summary =
    '<img src=x onerror="alert(1)"> A literal lesson example.';
  state.body.curriculum.references = [
    { title: "Unsafe example", url: "javascript:alert(1)" },
  ];
  await login(page);
  await openLesson(page);
  await expect(
    page.getByText(state.body.summary, { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lesson-document img")).toHaveCount(0);
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await page
    .getByLabel("Review note or comment")
    .fill("Feedback should not discard the unsaved lesson correction.");
  await expect(
    page.getByRole("button", { name: "Add comment", exact: true }),
  ).toBeDisabled();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Discard edits" }).click();
  await expect(page.getByLabel("Review note or comment")).not.toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Add comment", exact: true }),
  ).toBeEnabled();
});
test("lesson Markdown previews and renders without loading embedded images or unsafe links", async ({ page, context }) => {
  const state = await fixture(context);
  state.body.title = "# Database Migrations";
  state.body.summary = "Use **bold** and `GET /profiles/42`. ![remote](https://example.test/image.png) [unsafe](javascript:alert(1))";
  await login(page);
  await openLesson(page);
  const lesson = page.locator('.lesson-document');
  await expect(page.locator('.page-heading h1')).toHaveText('Database Migrations');
  await expect(lesson.locator('h2 h1')).toHaveCount(0);
  await expect(page.locator('.page-heading h1 h1')).toHaveCount(0);
  await expect(lesson.locator('strong')).toContainText(['bold']);
  await expect(lesson.locator('code')).toContainText(['GET /profiles/42']);
  await expect(lesson.locator('img')).toHaveCount(0);
  await expect(lesson.locator('a[href^="javascript:"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Prepare manual correction' }).click();
  await page.getByLabel('Explanation', { exact: true }).fill('A **reviewed** example with `PUT`.');
  const preview = page.getByRole('region', { name: 'Lesson Markdown preview' });
  await expect(preview.locator('strong')).toContainText(['reviewed']);
  await expect(preview.locator('code')).toContainText(['PUT']);
});

test("a malformed draft opens safely and can be completed without losing its taxonomy", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  state.invalid = true;
  await login(page);
  await openLesson(page);
  await expect(
    page.getByRole("heading", { name: "Lesson needing correction" }),
  ).toBeVisible();
  await expect(
    page.getByText("A complete lesson object is required", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await expect(page.getByLabel("Title", { exact: true })).toHaveValue("");
  await page
    .getByLabel("Review note or comment")
    .fill("Rebuild this incomplete draft as a complete lesson.");
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0].body.subtopic_slug).toBe("databases");
});
test("a stale draft keeps its correction and refreshes the version on reload", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
  await page.goto(`/?view=review&kind=legacy&id=${cid}`);
  await page.getByRole("heading", { name: "Review this lesson" }).waitFor();
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await page.getByLabel("Explanation", { exact: true }).fill(
    "A detailed correction that should remain in the editor after a stale-version response.",
  );
  await page.getByLabel("Review note or comment").fill(
    "Prepared a corrected explanation for a new review draft.",
  );
  state.token = "b".repeat(64);
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.getByText("Your feedback is preserved.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByLabel("Explanation", { exact: true })).toHaveValue(/detailed correction/);
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();
  expect(state.commands.at(-1).expected_token).toBe("b".repeat(64));
});
test("a changed live lesson requires review before rebasing a preserved correction", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await expect(
    page.getByRole("heading", { name: "A little care. Better learning." }),
  ).toBeVisible();
  await page.goto(`/?view=review&kind=legacy&id=${cid}`);
  await page.getByRole("heading", { name: "Review this lesson" }).waitFor();
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await page.getByLabel("Explanation", { exact: true }).fill(
    "My separate correction remains available when the live text changes.",
  );
  await page.getByLabel("Review note or comment").fill(
    "Reconcile this correction with the latest published lesson.",
  );
  state.body = { ...state.body, summary: "The live lesson was changed by a different reviewer." };
  state.token = "b".repeat(64);
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByText("The live lesson changed while you edited.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Explanation", { exact: true })).toHaveValue(/My separate correction/);
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeDisabled();
  await page.getByRole("button", { name: "Continue from latest version" }).click();
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeEnabled();
});
test("a revision correction refreshes the concept token and shows changed live content", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await page.getByLabel("Explanation", { exact: true }).fill(
    "Keep this reviewer correction while another editor changes the published lesson.",
  );
  await page.getByLabel("Review note or comment").fill(
    "Reconcile the correction with the changed published version.",
  );
  state.body = { ...state.body, summary: "Another editor updated the currently published lesson." };
  state.token = "b".repeat(64);
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Current live lesson" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Current live lesson" }).locator("..").getByText(
      "Another editor updated the currently published lesson.",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Explanation", { exact: true })).toHaveValue(/Keep this reviewer correction/);
  await page.getByRole("button", { name: "Continue from latest version" }).click();
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeVisible();
  expect(state.commands.at(-1).expected_token).toBe("b".repeat(64));
});
test("an older revision cannot stage its old body without comparing the live lesson", async ({ page, context }) => {
  const state = await fixture(context);
  state.baseVersion = 1;
  state.contentVersion = 2;
  state.liveBody = { ...state.body, summary: "A newer published explanation that the old revision must not silently replace." };
  await login(page);
  await openLesson(page);
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await expect(page.getByRole("alert").getByText("This revision is based on an older published lesson.", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Current live lesson" })).toBeVisible();
  await page.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(page.getByLabel("Explanation", { exact: true })).toHaveValue(state.body.summary);
  await page.getByLabel("Review note or comment").fill("Compare the old revision with the newer published content.");
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeDisabled();
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeDisabled();
  await page.getByRole("button", { name: "Continue from latest version" }).click();
  const expectedToken = state.token;
  await page.getByRole("button", { name: "Save as new draft" }).click();
  expect(state.commands.at(-1).expected_token).toBe(expectedToken);
});
test("a curriculum conflict explains the issue without locking the editor", async ({
  page,
  context,
}) => {
  const state = await fixture(context);
  await login(page);
  await openLesson(page);
  await page.getByRole("button", { name: "Prepare manual correction" }).click();
  await page.getByLabel("Review note or comment").fill(
    "Correct the prerequisite before submitting this review draft.",
  );
  state.validationConflict = true;
  await page.getByRole("button", { name: "Save as new draft" }).click();
  await expect(page.getByText("Unknown prerequisite missing-lesson")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save as new draft" })).toBeEnabled();
});
