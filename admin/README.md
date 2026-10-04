# One Concept Review

A private, branded editorial website, built independently from the Expo app.
React + TypeScript + Vite produce static files; Supabase Auth signs reviewers in,
and the existing FastAPI backend authorizes every editorial read and write.
The browser has no database, Gemini or service-role credentials.

Public source code and private workspace access are separate concerns. The
repository can remain public under its existing MIT license; the deployed
workspace requires invited individual accounts and backend authorization. Its
URL is not a secret or an access credential. A separate private repository is
not required to protect editorial data. Keep credentials out of source control
and browser builds, regardless of repository visibility.

## Run locally

Use Node 24. From `admin/`:

```sh
npm ci
cp .env.example .env.local
# Fill only the public settings below, using the intended environment.
npm run dev
```

| Public build variable | Meaning |
| --- | --- |
| `VITE_API_URL` | Exact HTTPS origin of the compatible FastAPI API; local development accepts `http://localhost:8000` or `http://127.0.0.1:8000`. |
| `VITE_SUPABASE_URL` | Matching Supabase Auth HTTPS origin. |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public `sb_publishable_…` key, or legacy JWT with role `anon`. Never a service-role/secret key. |
| `VITE_ENVIRONMENT` | Visible label, such as `Staging` or `Production`. |

The build rejects missing/invalid origins and privileged keys in the public key
field. All `VITE_` values are public: never add private values under that prefix.
No real credentials are needed for the automated tests.

```sh
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

`build` requires the public configuration and writes `dist/`. Browser tests start
an isolated local server, intercept API/Auth calls with fixtures, and exercise
actual browser navigation. They do not send invitations, run Gemini or publish
real lessons. Backend authorization/concurrency tests use disposable PostgreSQL.
The deployed host's headers and real Auth/email delivery need checks on the
actual HTTPS origin; local fixtures do not prove them.

## Reviewer journey

1. The owner invites an individual email; each person sets their own password.
2. The person submits their registered name. An authorized owner approves it.
3. They verify an authenticator before opening private editorial content.
4. They filter **Review queue** by topic, subtopic, status, assigned reviewer,
   deadline or title. Counts cover all matching records, independently of pages.
5. They open the complete explanation, example, curriculum, references,
   flashcard, and all three questions with answers. **Changes** compares fields;
   **History** shows earlier revisions, comments and decisions.
6. They leave comments, request changes or reject. An authorized approver checks
   every quality criterion and records a substantive note. A person with both
   approval and publication permission can **Approve and publish** atomically.
   Approval-only accounts send the revision to **Approved** for a publisher.
7. **Published** lists exact-version reviewed content. An approval is shared
   across the team: it is never a separate approval checklist per employee.
   A new correction is a new draft and requires its own review.

A second reviewer sees the shared result on refresh (queues poll every 30 seconds).
Open review pages detect changed tokens, preserve unsent feedback, and require
reload before another decision. The API rejects stale decisions even before
polling runs. A lost mutation response can be retried with the identical operation
ID; no successful publication is inferred from a spinner or timeout.

**Existing lessons** is the grandfathered unverified inventory. Those lessons
remain available to learners. Reviewers can comment, prepare a complete correction,
or, with approval/publication permission, attest the unchanged current lesson
only when its whole learning package meets validation. Partial older packages
show their original data and can be completed in the editor; they cannot bypass
the publication checklist.

## Corrections, ownership and settings

- **Prepare manual correction** creates a new draft without changing live text.
  Missing fields in older packages start empty. Decisions are disabled while
  editing so a comment cannot silently discard an unsaved correction.
- **Request AI correction** follows a changes-requested revision. The existing
  worker prepares a private draft; the website shows pending, generating, failed,
  cancelled, superseded or ready-for-review status and links the result. Use
  Reload/Refresh status for the latest worker result. No inherited approval.
- **AI requests** lets permitted reviewers request a bounded number of already
  planned lessons. Supply, generation switches and review capacity remain owned
  by the existing API/worker. Requesting demand does not promise immediate output.
- Owners assign a reviewer and an optional deadline with an audited note.
  Dates are entered/displayed in the browser's local timezone and stored in UTC.
  Deadlines never auto-approve content. Deadline notification emails are #279.
- **Reviewers** manages invitations, name approval, explicit permissions and
  revocation. Server safeguards protect the last owner and stale account edits.
- **Settings** shows the approved identity, pending name, environment and access.
  Name changes affect future signatures; historical evidence remains immutable.

Private lesson data and drafts are held in memory, not a persistent content cache.
Sign-out/account changes discard them and fence late responses. The Auth client
stores its own session; the only additional local preference is the theme.
Unsent review feedback prompts before navigation or sign-out. References allow
only HTTP(S), open separately with no opener, and lesson text is rendered as text.

## Hosting and manual activation

The reviewer workspace and Owner dashboard deploy as one static site. The
[direct production rollout guide](../docs/EDITORIAL_ROLLOUT.md) gives the free
Netlify build settings, exact API/Auth origins, account and email setup,
verification and rollback. `npm run build` writes `dist/_headers` with CSP
`connect-src` restricted to the two configured origins; the old broad static
header file is no longer used. Netlify uses `public/_redirects` for the
`/auth/callback` SPA fallback. Preview deployments remain off until a separate
non-production environment exists under #255.

The public `/about.html` and `/privacy.html` pages describe the workspace and
its send-only Gmail integration for Google's OAuth Branding form. They are
static files in `public/`, so they load without initializing Supabase Auth or
exposing private review data. Check both live URLs after the production Netlify
deploy before entering them in Google Cloud. The root remains the invited-user
sign-in page; it is not the public OAuth homepage. Do not substitute the mobile
app's separate API privacy page for this site's privacy URL.

Merging a code PR into `develop` does not publish the website or change Railway
flags. After the compatible backend and website are live, an approved and
published card enters normal server selection automatically; each content
approval needs no app release. Software/schema changes still use the normal
release procedure.

## Reviewer notifications

Owners can open **Notifications** to see overdue assignments, delivery failures,
review policy and bounded retries. Reviewers choose their email deadline timezone
in **Settings**. Delivery uses the existing backend worker and the sender's Gmail
HTTPS API; no SMTP upgrade or new paid mail service is required. Follow the
[notification setup and direct production rollout](../docs/editorial-notifications.md)
before enabling email. Supabase Auth email templates remain separate.

## Owner dashboard and safe demo

Administrators with `manage_reviewers`, an approved name and MFA can open
**Owner dashboard** for learner activity, reviewer contributions, service/job
observations and safe event searches. These read-only reports are server-gated.
See [metric definitions, limits and rollout](../docs/owner-dashboard.md).

For a synthetic preview, run the development server and open `/?demo=owner`.
This mode constructs no Auth/API client and requires no live credentials. It
shares the real report components, light/dark themes and responsive layouts.
No new dashboard deployment or staging setup occurs in #297; #281 owns activation.
