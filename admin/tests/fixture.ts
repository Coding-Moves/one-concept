import type { BrowserContext, Page, Route } from "@playwright/test";
export const uid = "00000000-0000-4000-8000-000000000001",
  rid = "10000000-0000-4000-8000-000000000001",
  cid = "20000000-0000-4000-8000-000000000001",
  tid = "30000000-0000-4000-8000-000000000001",
  sid = "40000000-0000-4000-8000-000000000001";
export const lesson = {
  title: "Database Migrations",
  summary:
    "Database migrations record schema changes as a sequence of versioned steps. A careful migration keeps data and application code compatible while teams ship improvements.",
  example:
    "Add a nullable column before deploying code that writes it. Backfill existing rows, then apply the constraint once every row is ready.",
  subtopic_slug: "databases",
  model: "test-provider",
  prompt_version: "v1",
  curriculum: {
    objective: "Plan a backwards-compatible database schema change.",
    difficulty: 2,
    prerequisites: ["database-indexes"],
    references: [
      {
        title: "PostgreSQL documentation",
        url: "https://www.postgresql.org/docs/",
      },
    ],
  },
  learning_package: {
    flashcard: {
      front: "Why are database migrations versioned?",
      back: "Versioned steps make changes reproducible and auditable.",
    },
    mcqs: [
      {
        question: "Which step preserves compatibility?",
        options: [
          "Add a nullable column",
          "Delete every record",
          "Skip a backup",
          "Remove the table",
        ],
        correct_index: 0,
      },
      {
        question: "When should you add a NOT NULL constraint?",
        options: [
          "Before planning",
          "After backfilling",
          "Never",
          "Before adding the column",
        ],
        correct_index: 1,
      },
      {
        question: "What does migration history provide?",
        options: [
          "An audit trail",
          "A password",
          "A new keyboard",
          "A leaderboard",
        ],
        correct_index: 0,
      },
    ],
  },
};
export async function fixture(
  context: BrowserContext,
  options: {
    caps?: string[];
    mfa?: boolean;
    enrollment?: boolean;
    onboarding?: boolean;
  } = {},
) {
  const member = {
    user_id: uid,
    invited_email: "reviewer@example.test",
    status: "active",
    capabilities: options.caps || [
      "review",
      "approve",
      "publish",
      "manage_reviewers",
      "request_generation",
    ],
    requested_name: options.onboarding ? null : "Amina Khan",
    approved_name: options.onboarding ? null : "Amina Khan",
    version: 1,
  };
  const state = {
    status: "pending_review",
    token: "a".repeat(64),
    body: structuredClone(lesson),
    liveBody: null as typeof lesson | null,
    baseVersion: 1,
    contentVersion: 1,
    events: [] as object[],
    approvedBy: null as string | null,
    expired: false,
    denied: false,
    uncertain: false,
    conflict: false,
    validationConflict: false,
    invalid: false,
    mfa: options.mfa || false,
    commands: [] as any[],
    jobs: [] as any[],
    member,
    members: [member],
  };
  let version = 1;
  const receipts = new Map<string, object>();
  const user = {
    id: uid,
    email: member.invited_email,
    aud: "authenticated",
    role: "authenticated",
    created_at: new Date().toISOString(),
    app_metadata: {},
    user_metadata: {},
    factors:
      options.mfa && !options.enrollment
        ? [
            {
              id: sid,
              factor_type: "totp",
              status: "verified",
              friendly_name: "My authenticator",
            },
          ]
        : [],
  };
  function session() {
    const token =
      [
        { alg: "HS256" },
        {
          sub: uid,
          aud: "authenticated",
          exp: Math.floor(Date.now() / 1000) + 3600,
          iat: Math.floor(Date.now() / 1000),
          aal: state.mfa ? "aal1" : "aal2",
          session_id: sid,
        },
      ]
        .map((x) => Buffer.from(JSON.stringify(x)).toString("base64url"))
        .join(".") + ".test";
    return {
      access_token: token,
      refresh_token: "test-refresh",
      token_type: "bearer",
      expires_in: 3600,
      user,
    };
  }
  const fulfill = (route: Route, json: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(json),
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "*",
        "access-control-allow-methods": "GET,POST,PATCH,PUT,OPTIONS",
      },
    });
  await context.route("https://review-auth.test/**", async (route) => {
    if (route.request().method() === "OPTIONS") return fulfill(route, {});
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/logout")) return fulfill(route, {});
    if (path.endsWith("/recover")) return fulfill(route, {});
    if (path.endsWith("/factors") && route.request().method() === "POST")
      return fulfill(route, {
        id: sid,
        type: "totp",
        totp: {
          secret: "fixture-only",
          uri: "otpauth://totp/test",
          qr_code:
            '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="black"/></svg>',
        },
      });
    if (path.includes("/challenge"))
      return fulfill(route, {
        id: "challenge",
        expires_at: Date.now() + 60000,
      });
    if (path.includes("/verify")) {
      state.mfa = false;
      return fulfill(route, session());
    }
    if (path.endsWith("/user")) return fulfill(route, user);
    return fulfill(route, session());
  });
  await context.route("http://127.0.0.1:8000/**", async (route) => {
    if (route.request().method() === "OPTIONS") return fulfill(route, {});
    if (state.expired)
      return fulfill(route, { detail: "Session expired" }, 401);
    if (state.denied) return fulfill(route, { detail: "No access" }, 403);
    const url = new URL(route.request().url()),
      path = url.pathname.replace("/v1/editorial", ""),
      method = route.request().method(),
      body = method === "GET" ? null : route.request().postDataJSON();
    const detail = {
      id: rid,
      concept_id: cid,
      status: state.status,
      base_version: state.baseVersion,
      token: state.token,
      body: state.invalid ? null : state.body,
      source_body: { ...lesson, summary: "Previous explanation." },
      assigned_to: null,
      review_due_at: null,
      approved_by: state.approvedBy,
      diff: [
        {
          field: "summary",
          before: "Previous explanation.",
          after: state.body.summary,
        },
      ],
      validation: {
        valid: !state.invalid,
        errors: state.invalid
          ? [{ field: "body", message: "A complete lesson object is required" }]
          : [],
      },
      source_links: state.body.curriculum.references,
    };
    if (path === "/me")
      return fulfill(route, {
        member: state.member,
        onboarding_required: !state.member.requested_name,
        name_approval_pending:
          state.member.requested_name !== state.member.approved_name,
        mfa_required: state.mfa,
      });
    if (path === "/me/profile") {
      Object.assign(state.member, {
        requested_name: body.registered_name,
        version: 2,
      });
      return fulfill(route, state.member);
    }
    if (path === "/taxonomy")
      return fulfill(route, {
        items: [
          {
            id: sid,
            name: "Databases",
            topic_id: tid,
            topic_name: "Software Engineering",
            is_active: true,
            topic_active: true,
          },
        ],
        next_cursor: null,
      });
    if (path === "/reviewers")
      return fulfill(
        route,
        method === "GET"
          ? { items: state.members, next_cursor: null }
          : state.member,
        method === "GET" ? 200 : 201,
      );
    if (path === "/queue") {
      const kind = url.searchParams.get("kind"),
        status = url.searchParams.get("status"),
        search = url.searchParams.get("search");
      const matches =
        (!status || status === state.status) &&
        (!search ||
          lesson.title.toLowerCase().includes(search.toLowerCase())) &&
        (kind !== "published" || state.status === "published");
      return fulfill(route, {
        items: matches
          ? [
              {
                ...detail,
                id: kind === "published" ? cid : rid,
                title: lesson.title,
                slug: "database-migrations",
                topic_name: "Software Engineering",
                subtopic_name: "Databases",
                topic_id: tid,
                subtopic_id: sid,
                content_version: state.contentVersion,
              },
            ]
          : [],
        total: matches ? 1 : 0,
        next_cursor: null,
      });
    }
    if (path === "/generation-jobs")
      return fulfill(route, { items: state.jobs, next_cursor: null });
    if (path.startsWith("/generation-supply/"))
      return fulfill(route, {
        published: 18,
        drafts: 3,
        pending: 10,
        generating: 0,
        failed: 0,
        review_load: 3,
        review_capacity: 25,
        review_blocked: false,
        planning_required: false,
        generation_enabled: true,
        provider_configured: true,
      });
    if (method === "POST") {
      state.commands.push(body);
      if (receipts.has(body.request_id))
        return fulfill(route, receipts.get(body.request_id));
      if (state.validationConflict && path.endsWith("/revisions"))
        return fulfill(route, {
          detail: { code: "review_conflict", message: "Unknown prerequisite missing-lesson" },
        }, 409);
      if (
        state.conflict ||
        (body.expected_token && body.expected_token !== state.token)
      )
        return fulfill(route, { detail: { code: "stale_revision" } }, 409);
      if (body.action === "approved" || body.action === "approve_and_publish") {
        state.status = body.action === "approved" ? "approved" : "published";
        state.approvedBy = "Amina Khan";
        if (body.action === "approve_and_publish") state.contentVersion++;
      } else if (body.action === "publish") {
        state.status = "published";
        state.contentVersion++;
      } else if (
        body.action === "changes_requested" ||
        body.action === "rejected"
      )
        state.status = body.action;
      else if (body.action === "submit") state.status = "pending_review";
      else if (path.endsWith("/revisions")) {
        state.status = "draft";
        state.body = body.body;
      }
      if (path.endsWith("/generation-requests"))
        state.jobs = [
          {
            id: "job",
            concept_id: cid,
            source_revision_id: rid,
            result_revision_id: null,
            status: "pending",
            attempts: 0,
            token: state.token,
            failure_code: null,
          },
        ];
      state.token = (++version).toString(16).padStart(64, "0");
      state.events.push({
        id: String(version),
        registered_name: "Amina Khan",
        action: body.action || "staged",
        note: body.note,
        created_at: new Date().toISOString(),
        details: {},
      });
      const result = {
        ...(path.startsWith("/concepts/") && path.endsWith("/actions")
          ? { concept_id: cid }
          : { revision_id: rid }),
        status: path.endsWith("/generation-requests")
          ? "pending"
          : state.status,
        token: state.token,
        published_version: state.status === "published" ? state.contentVersion : null,
      };
      receipts.set(body.request_id, result);
      if (state.uncertain) {
        state.uncertain = false;
        return route.abort();
      }
      return fulfill(route, result);
    }
    if (path.endsWith("/timeline"))
      return fulfill(route, { items: state.events, next_cursor: null });
    if (path.endsWith("/revisions"))
      return fulfill(route, {
        items: [
          {
            id: rid,
            status: state.status,
            base_version: state.baseVersion,
            created_at: new Date().toISOString(),
          },
        ],
        next_cursor: null,
      });
    if (path.startsWith("/concepts/"))
      return fulfill(route, {
        ...detail,
        id: cid,
        body: state.liveBody ?? state.body,
        concept_id: undefined,
        content_version: state.contentVersion,
        unchanged_legacy: true,
        provenance: state.approvedBy
          ? { registered_name: state.approvedBy }
          : null,
      });
    if (path.startsWith("/revisions/")) return fulfill(route, detail);
    return fulfill(route, { detail: "Unexpected fixture route " + path }, 404);
  });
  return state;
}
export async function login(page: Page) {
  await page.goto("/");
  await page.getByLabel("Email address").fill("reviewer@example.test");
  await page
    .getByLabel("Password", { exact: true })
    .fill("private-fixture-password");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}
export async function openLesson(page: Page) {
  await page
    .getByRole("button")
    .filter({ hasText: "Database Migrations" })
    .click();
  await page.getByRole("heading", { name: "Review this lesson" }).waitFor();
}
export async function checkAll(page: Page) {
  for (const box of await page.getByRole("checkbox").all()) await box.check();
  await page.getByLabel("Sensitive content").selectOption("not_applicable");
  await page
    .getByLabel("Review note or comment")
    .fill("Checked the full lesson and all answers against the references.");
}
