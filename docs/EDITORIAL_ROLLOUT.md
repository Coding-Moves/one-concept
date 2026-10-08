# Reviewer website: direct production rollout (#281 / #313)

The reviewer and owner dashboards are two sections of the same `admin/` site.
They use the existing production FastAPI service and Supabase Auth; no new
backend service or paid frontend plan is required. Static hosting needs no
purchased domain; Google's OAuth verification may require a domain the owner
can prove they control before reviewer email can be enabled. The owner
deferred an isolated staging environment to #255. This runbook records a direct
production rollout, without claiming that local tests prove live email delivery.

Netlify Free fits the single-operator site: it accepts `_headers` and
`_redirects` in the publish directory and has a hard spending limit. Render
static hosting is a fallback but requires separately configured header/rewrite
rules and its free Hobby allowance is 5 GB outbound bandwidth; an attached
payment method permits overage billing. Vercel Hobby is for personal,
non-commercial use, so it is not our organization dashboard's default.
Putting both frontend and backend on one free Render web service would replace
the healthy Railway API with an instance that sleeps after 15 minutes; Render
cron jobs are not free. Vercel Hobby cron cannot run the existing 15-minute
reminder schedule. Bundling the SPA into the current Railway API image is
technically possible, but would require changing its `/backend` Docker build
context and redeploying production for no functional benefit to reviewers.
Keep the working API and scheduled workers on Railway and host only static
assets here.
See [Netlify pricing](https://www.netlify.com/pricing/),
[Netlify headers](https://docs.netlify.com/manage/routing/headers/),
[Netlify SPA rewrites](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/),
[Render bandwidth](https://render.com/docs/outbound-bandwidth) and
[Render free services](https://render.com/docs/free),
[Render cron pricing](https://render.com/docs/cronjobs),
[Vercel cron limits](https://vercel.com/docs/cron-jobs/usage-and-pricing) and
[Vercel pricing](https://vercel.com/pricing).

## 1. Create the free HTTPS site

In [Netlify](https://app.netlify.com/start), choose **Add new project → Import
an existing project → GitHub**, connect `Coding-Moves/one-concept`, and select
the **Free** plan. This public repository needs one Netlify site owner; reviewers
sign in to our app and do not need Netlify team seats. Set:

| Netlify setting | Value |
| --- | --- |
| Production branch | `main` |
| Base directory | `admin` |
| Build command | `npm run build` (Netlify installs from `admin/package-lock.json`) |
| Publish directory | `dist`, relative to the base directory |
| Node version | `24` from `admin/.node-version` |
| Branch deploys and Deploy Previews | Disable both until #255 provides an isolated non-production API/Auth |

After project creation, check **Project configuration → Developer settings →
Continuous deployment → Branches and deploy contexts** for those two preview
controls. Production remains connected to `main` only.

Use the supplied `https://<project>.netlify.app` hostname. New credit-based
sites may start unpublished; publish the successful production deploy when
ready. Record its **exact origin** (no path or trailing slash) privately in the
rollout notes. `admin/public/_redirects` creates an SPA rewrite so
`/auth/callback` and review links return the app on direct load. `npm run build`
generates `dist/_headers` with a strict `connect-src` for the configured API
and Auth origins, plus no-store, no-referrer, frame denial and noindex. Do not
add a wildcard CORS origin or production credentials to previews.

Set these **Production-only** build variables in Netlify before the first
successful build (**Project configuration → Environment variables**); do not
give them a default value shared with preview contexts:

| Variable | Production value |
| --- | --- |
| `VITE_API_URL` | Exact `https://one-concept-production.up.railway.app` origin, or the verified current API origin |
| `VITE_SUPABASE_URL` | Exact production Supabase project URL from its API settings |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Production `sb_publishable_…` or legacy anon **public** key |
| `VITE_ENVIRONMENT` | `Production` |

Only these public values go into the browser bundle. Never put a database URL,
Supabase service-role/secret key, Gmail OAuth token, or Gemini key in Netlify.
Netlify Free has a hard limit of 300 usage credits per month; a new production
deploy uses 15 credits, and traffic also consumes credits. The site pauses at
the limit until reset. Monitor account usage; leave auto recharge off. Existing
Railway, Supabase, Gmail and AI limits still apply. If Netlify requires billing
or an upgrade, stop and reassess the free host instead of paying.

## 2. Connect the existing production services

The owner reported migrations through 0039 applied and the protected production
schema check passed for the v1.10.4 release. Before switching flags, verify the
current `main` API and reminders revisions and `/health` again. Do not rerun
applied migrations or change `applied.txt` just to satisfy a deployment check.

In Railway's **api** variables:

- Append the exact Netlify HTTPS origin to the comma-separated `ALLOWED_ORIGINS`,
  retaining existing origins. No `*` and no callback path here.
- Set `EDITORIAL_INVITE_REDIRECT_URL` to that origin plus `/auth/callback`.
- Set `EDITORIAL_EMAIL_DASHBOARD_URL` to the exact origin, with no path.
- Keep `EDITORIAL_ENABLED=false` and `EDITORIAL_EMAIL_ENABLED=false` until the
  account and sender steps below. Keep `GENERATION_ENABLED` unchanged.

In **reminders**, set the same dashboard origin and retain the existing Gmail
sender variables and 15-minute cron. Keep `EDITORIAL_EMAIL_ENABLED=false` during
setup. Do not replace its start command with a schema check; it must remain
`python -m app.workers.reminders`. Owner telemetry can remain off during this
rollout. Supabase Auth → URL Configuration → Redirect URLs must allow the exact
`https://<project>.netlify.app/auth/callback` URL for invitations and recovery;
retain the mobile app's existing redirects. Supabase's existing Auth SMTP and
HTML templates stay as configured.

Wait for the matching API deployment, then check the site root and a direct
`/auth/callback` reload. Inspect HTTPS response headers on both. Verify the
deployed CSP names only the configured API/Auth origins, and the login screen
has no privileged key or private content before authentication. A `netlify.app`
URL is public; server authorization, not URL secrecy, protects drafts.

## 3. Enable the private review workspace

Use a **confirmed, unbanned** Supabase Auth account for the intended owner. If
no editorial owner has ever been bootstrapped, run the one-time backend CLI in
the production environment:

```sh
python -m app.workers.editorial_accounts --email OWNER_EMAIL --name "LEGAL_NAME"
```

Supply the actual email and approved legal name privately. This command refuses
to run after a prior membership/bootstrap event; do not retry it to repair an
existing account. Set `EDITORIAL_ENABLED=true` on the API only after the site,
CORS, callback and owner membership are ready. Sign in on the Netlify site, enroll
and verify TOTP to reach `aal2`, and confirm that an ordinary signed-in learner
cannot read the review queue or owner reports. An owner with `manage_reviewers`
can invite each reviewer through **Reviewers**, approve their registered name,
and grant only the needed capabilities (`review`, plus `approve`/`publish` where
appropriate). Assignment requires `review`; a separate `approve`-only or
`publish`-only member can still read the private lesson and shared queue needed
for that decision, with the same approved-name and MFA checks. Reviewers use
individual accounts and MFA; no GitHub or database
console access is required. Set their timezone in **Settings**.

Test the website on its actual HTTPS origin: root/callback/review deep links,
sign-out and sign-in return, permission denial, topic filter, one existing
private draft, comments and shared decision state. Do not publish a test lesson
into the learner catalog. See [editorial accounts](editorial-accounts.md) for
first-owner and recovery constraints and [owner reporting](owner-dashboard.md)
for the report permission model.

## 4. Enable reviewer email after the sender is durable

The existing Gmail HTTPS sender uses `gmail.send`, not Supabase Auth SMTP.
Google's External Testing status issues Gmail refresh tokens that expire after
seven days. Before attempting to publish the OAuth app, use its **Branding**
page to set an accurate app name (for example, `One Concept Review`), the
owner's monitored support/developer email, and these public URLs **after the
matching `main` site deploy is live**:

| Google Branding field | URL |
| --- | --- |
| Application home page | `https://coding-moves-one-concept-review.netlify.app/about.html` |
| Privacy policy | `https://coding-moves-one-concept-review.netlify.app/privacy.html` |

The homepage links to this same-domain policy. Leave the optional logo blank;
do not use the sign-in root as a homepage or the separate learning-app API
privacy page as this website's policy. No Terms of Service URL is supplied by
this change. Register the actual site host as an authorized domain if Google
asks for it, and follow Google's domain-ownership process if required. A free
Netlify hostname is not a promise that Google will accept it for every level of
OAuth verification; if Google requires a domain you cannot verify, keep email
off and revisit the sender plan rather than inventing an address or buying a
service without a separate decision. Publishing the OAuth app does not make
private lessons public.
[Google's audience rules](https://support.google.com/cloud/answer/15549945)
explain Testing token expiry, and its
[branding requirements](https://support.google.com/cloud/answer/15549049)
describe public same-domain policy links and domain verification.

Confirm its Google OAuth app is appropriately published/verified and refresh
authorization was obtained after leaving External Testing. Check that both API
and reminders hold the matching sender address/client ID/client secret/refresh
token **without exposing values**. The owner-selected default remains a 48-hour
deadline, one reminder every 24 hours, maximum two reminders and a 40-attempt
daily cap. [Notification setup](editorial-notifications.md) has the limits and
diagnosis details.

Only then set `EDITORIAL_ENABLED=true` and `EDITORIAL_EMAIL_ENABLED=true` on
**api and reminders**, with their dashboard URL pointing to the deployed Netlify
origin. Assign one real, owner-approved review item; wait for the five-minute
collection window and the next ordinary 15-minute worker run. Confirm actual
inbox receipt, HTML and plain text, topic/deadline/timezone, and signed-out
login/MFA return to the correct revision. Gmail acceptance alone does not prove
receipt. The owner **Notifications** page shows sanitized configuration/delivery
failures and quota usage. Avoid a retrospective assignment blast.

## Rollback and operations

- To stop new mail, set `EDITORIAL_EMAIL_ENABLED=false` on API and reminders.
  The review queue stays usable; failed mail never approves a card.
- To stop editorial writes/access, set `EDITORIAL_ENABLED=false` on API. Keep
  the additive schema, approved catalog, immutable review evidence and existing
  learner history. Do not roll back to an old auto-publishing worker.
- For sender authorization, quota, absent reviewer or stale assignment, use
  Notifications and reassign/retry within the existing caps. Revoke a reviewer
  through Reviewers and Supabase sessions if needed. A depleted approved supply
  is not permission to publish unverified drafts.
- If Netlify is unavailable, disable email first so messages do not link to an
  unusable site. Restore the previous site deployment or fix its variables and
  check root/callback before re-enabling delivery.

Record the live Netlify origin, deployed `main` commit, API/reminders commit and
status, owner/reviewer acceptance and first real email result in #359 without
posting private account data or tokens. The original direct rollout was tracked
in #281 and #313; #359 tracks the remaining integration acceptance. Future
staging, if added under #255, must
use a separate API, Auth project, database and test-recipient allowlist.

## #359 production integration rehearsal

The local PostgreSQL, browser, and mobile checks exercise behavior with test
identities and mocked external providers. They do not establish that the live
site, Gmail inbox, AI worker, and installed phone are synchronized. After this
change is released to `main`, record the following evidence in #359 without
email addresses, tokens, lesson text, or database URLs:

1. Confirm Netlify's published deploy and Railway's `api`, `reminders`, and
   `pool-topup` deployments all show the intended `main` commit and healthy or
   completed status. Check the API `/health` endpoint. The site polls queues;
   allow one refresh cycle or use **Refresh** before judging a missing result.
2. As owner, assign one structurally valid private draft to an approved
   `review`-capable second account. Confirm that account sees **Pending review**
   after signing in with its own MFA. Check the owner's Notifications status and
   the recipient inbox for the actual assignment message; Gmail acceptance alone
   is not inbox receipt. Do not treat an approve-only account as an assignee.
3. From the second account, request a concrete change. As owner, inspect the
   recorded feedback, request an AI correction if applicable, and confirm a new
   private revision appears with the corrected complete package. A manual
   correction can exercise the review path when AI is disabled, but does not
   verify the worker or provider.
4. Review and approve the corrected revision, then publish it with an authorized
   account. Confirm the shared Published library lists the exact lesson and the
   published detail still shows a structured Lesson, Changes, and History view.
   Reopen that historical revision after a later correction or retirement when
   available; it must remain readable without a stale action warning.
5. On an eligible learner account, refresh Today or the lesson detail online.
   Confirm the expected content version and reviewer attribution. If the lesson
   is saved, sync while online, then reopen it offline to verify the corrected
   version was cached. An existing daily assignment keeps its identity; the
   learner does not receive an extra assignment because of publication.

If any step fails, record the failed step and the public status/error code in
#359, leave the issue open, and address the defect before claiming completion.
Do not publish a knowingly invalid draft merely to complete the rehearsal.
