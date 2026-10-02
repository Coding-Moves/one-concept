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
# Fill only the public settings below, using a staging environment.
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
The hosting provider's headers and real Auth email delivery need staging checks.

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

This PR supplies static deployment output and a staging runbook. It does **not**
create a paid service, choose a production host, change live flags, or send real
invitations. Hosting and live acceptance remain [#281](https://github.com/Coding-Moves/one-concept/issues/281).
Owner analytics are [#297](https://github.com/Coding-Moves/one-concept/issues/297).

Before a staging deployment:

1. Apply ordered backend migrations through
   [`0037_editorial_review_deadlines.sql`](../backend/migrations/0037_editorial_review_deadlines.sql),
   after 0036, and verify the schema using the existing migration procedure.
   Do not mark production `applied.txt` based on staging or CI.
2. Deploy the compatible backend/API and existing worker revision. Follow
   [editorial accounts](../docs/editorial-accounts.md),
   [workflow API](../docs/editorial-api.md), and
   [generation operations](../docs/editorial-generation.md) for prerequisites.
   Set editorial flags only in the intended environment; generation remains
   independently controlled and is unnecessary for reviewing existing drafts.
3. Configure a static host with root `admin`, install `npm ci`, build
   `npm run build`, output `dist`. It needs HTTPS and an SPA fallback to
   `/index.html`, including `/auth/callback`. There is no Node production server.
4. Supply only the four public build values. Preserve `public/_headers` on hosts
   that support that format; translate them on other hosts. Narrow CSP
   `connect-src` to the exact API/Auth origins. Retain `no-store`, `no-referrer`,
   frame denial, no external scripts, and no search indexing. Verify the deployed
   headers; the Vite development server does not validate host header rules.
5. Add the exact web origin to backend `ALLOWED_ORIGINS`. Set backend
   `EDITORIAL_INVITE_REDIRECT_URL=https://<review-host>/auth/callback`; add the
   same exact URL in Supabase's redirect allowlist for invitations and recovery.
   Verify Auth mail delivery and open recovery links in the browser that requested
   them (PKCE). Do not remove the mobile app's existing allowed origins/redirects.
6. Bootstrap the confirmed owner using the protected CLI documented in the
   accounts guide. Sign in, set up MFA, then invite the actual reviewers. Never
   share owner passwords or paste private keys in issues.
7. Test two **different** invited accounts on staging: topic filtering, comment,
   change request, correction, one shared approval, publication, name attribution,
   owner-only assignment, revocation, lost-response retry, expiry, and sign-out.
   Check light/dark themes, keyboard navigation and a narrow browser. Confirm
   published lessons reach a staging mobile client through its normal API.

Merging this feature into `develop` neither publishes the website nor applies SQL.
Once the compatible backend is deployed, newly approved-and-published cards enter
normal server selection automatically; each content approval needs no mobile
release. Mobile attribution UI remains #280. The existing rules for a software
release still apply when shipping new application code.

## Reviewer notifications

Owners can open **Notifications** to see overdue assignments, delivery failures,
review policy and bounded retries. Reviewers choose their email deadline timezone
in **Settings**. Delivery uses the existing backend worker and the sender's Gmail
HTTPS API; no SMTP upgrade or new paid mail service is required. Follow the
[notification setup and direct production rollout](../docs/editorial-notifications.md)
before enabling email. Supabase Auth email templates remain separate.
