# Reviewer email notifications (#279)

Assigned reviewers receive batched links to lessons that need review. The queue
remains the source of truth, including when email is disabled or unavailable.
No email approves or publishes content. This is phase 6 of #263; deployment and
production activation belong to #281. The owner selected a direct production
rollout; a separate staging environment is not required for this email feature. The Auth sender track (#171/#152, draft
PR #187) remains separate and its HTML login/recovery templates are unchanged.

## No additional paid mail service

The owner already uses Gmail SMTP through Supabase Auth. **Do not copy those
SMTP settings into Railway:** Railway Free, Trial and Hobby block SMTP; it is
available on Pro and above. The backend instead calls the **Gmail HTTPS API**
using the same account and the send-only `gmail.send` OAuth scope. No mailbox
read permission, new domain, Google Workspace subscription or Railway upgrade
is needed for this design.

Google documents standard Gmail API use at no additional cost, subject to
quotas, and describes future charges for excess quota. Keep billing unlinked,
do not enable a paid quota increase, and retain the default application cap of
40 attempts per rolling 24 hours. Gmail account limits also cover Auth emails
and the owner's other mail; this application's cap cannot reserve capacity for
those other senders. The existing Railway worker/database still consume their
normal resource allowance: this does not make hosting unlimited or free forever.

Checked 2026-10-02 against primary sources:

- [Railway outbound networking](https://docs.railway.com/networking/outbound-networking)
- [Gmail API usage and pricing](https://developers.google.com/workspace/gmail/api/reference/quota)
- [Gmail account sending limits](https://support.google.com/mail/answer/22839)
- [Send-message API](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
- [OAuth offline access](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Refresh-token expiration, including testing apps](https://developers.google.com/identity/protocols/oauth2)

Gmail does not document an idempotency key for `messages.send`. Stable Message-ID
headers and batch IDs aid diagnosis, but do **not** guarantee exactly-once mail.
A timeout or crash after provider acceptance can produce a duplicate on retry.
A successful API response means acceptance, not verified inbox delivery.

## Behavior and controls

- Migration `0038_editorial_notifications.sql` adds private RLS-protected policy,
  outbox, batches and durable attempt records. Assignment/reviewable-state
  triggers write the outbox in the same transaction as the revision. Corrected
  AI drafts inherit the current source assignment, with a fresh deadline.
- Initial defaults chosen by the owner: **48-hour deadline, 24-hour reminder
  interval, maximum two reminders**. Due dates are UTC; each reviewer's Settings
  page accepts an IANA timezone, default UTC. Emails render deadlines in that
  zone, including daylight-saving rules. Frozen retry bodies retain their dates.
- Owners assign work using the existing review page. An empty date on an assigned
  review uses the default window; unassign explicitly to stop that assignment.
  `draft` → `pending_review` does not create another initial email. Reassignment,
  a changed deadline, or reentry into review creates a new assignment cycle.
- No automatic retrospective notification blast. Pre-migration assignments need
  an explicit assignment/deadline update to start their notification cycle.
- Five-minute collection window, up to 25 distinct lessons per recipient batch,
  ten batches/deliveries per existing 15-minute reminders-worker invocation.
  Missed reminder intervals collapse to the latest due ordinal; no catch-up storm.
- Owner Notifications page exposes overdue count, delivery states, sanitized
  failure codes, rolling usage and versioned policy controls. Existing queue
  urgency filtering supports reassignment. Overdue content never bypasses human
  review. Existing generation backlog limits continue to apply.
- Changing the default window does not rewrite existing deadlines. Reminder
  policy changes affect scheduling for current assignments. Zero maximum stops
  creating new reminders; already queued batches can still run. The email kill
  switch stops all delivery. Resetting an assignment creates a new cycle/budget.
- Five attempts maximum per batch, including crash recovery and manual retries.
  Retry delays: 15, 30, 60, 120 minutes (bounded by a 360-minute ceiling). A
  durable ten-minute lease fences stale workers. Failed fifth attempts remain
  terminal; owner retries never reset the attempt count or daily cap.
- Before delivery the worker rechecks assigned user, review cycle/state, current
  concept version, active taxonomy, approved reviewer name, review capability,
  confirmed account, ban status and actual email matching the invited address.
  Revoked/reassigned/approved/rejected/stale work is suppressed. A partially
  obsolete batch is discarded; valid items can be regrouped next tick.
- Final validation and bounded Gmail requests hold the existing account/catalog
  transaction locks. A mutation already committed wins before sending; a review
  action waiting behind an in-flight send can finish afterward. An email already
  accepted cannot be recalled and may arrive after that action. The dashboard
  always shows current truth. These locks may briefly delay editorial writes.
- Email sends use fixed Google HTTPS endpoints, verified TLS, bounded timeouts,
  no automatic redirects, send-only OAuth and backend-only credentials. Links
  contain revision IDs, never credentials, and require normal login plus MFA.

## Email template

Reviewer notices include both a branded HTML email and a plain-text fallback.
The reusable template is
[`backend/app/templates/editorial_review.html`](../backend/app/templates/editorial_review.html);
[`editorial_email_template.py`](../backend/app/services/editorial_email_template.py)
escapes every content value and creates buttons only for exact configured
workspace revision links. It uses no remote images, tracking pixels or scripts.
The frozen batch supplies identical topics and timezone-adjusted deadlines to
both versions; neither version contains an approval action or login token.
No template needs to be pasted into Supabase: these notices are sent by the
backend, separately from Supabase's existing Auth templates.

## Direct production rollout

The owner explicitly chose to finish this PR without creating or testing in a
staging environment. Automated PostgreSQL, mocked Gmail and browser tests remain
part of the PR; live inbox delivery is an operational outcome and is not claimed
by those tests. No staging attestation or staging-only runtime flag is required.

1. **Prepare now:** save Gmail OAuth credentials on the production API and
   existing reminders worker. Keep `EDITORIAL_EMAIL_ENABLED=false` until the
   matching software, schema and reviewer website are available. The previously
   suggested `EDITORIAL_EMAIL_STAGING_VERIFIED` variable is obsolete and ignored;
   an existing `false` value does not block sending after this PR is deployed.
   It may be removed at your convenience; do not set it to claim testing occurred.
2. **Release:** merge this feature PR into `develop`, then use the normal
   `develop` → `main` release process. Apply all ordered migrations through
   **0038** and verify the production schema before new backend code starts.
   Deploy matching API/worker revisions and the reviewer website. No separate
   mobile APK is needed for reviewer email.
3. **Connect:** configure the exact HTTPS reviewer website origin in
   `EDITORIAL_EMAIL_DASHBOARD_URL` and `ALLOWED_ORIGINS`. Follow the reviewer
   website guide for Auth redirects, owner bootstrap, MFA and reviewer accounts.
   Select each reviewer's timezone in Settings; it defaults to UTC.
4. **Enable:** after Google authorization is durable (see below), set
   `EDITORIAL_ENABLED=true` and `EDITORIAL_EMAIL_ENABLED=true` on the API and
   reminders worker. Retain the existing 15-minute worker schedule. The owner
   can now assign real review work; its outbox event waits five minutes before
   the next worker run batches and sends it. No extra email service is needed.
5. **Observe:** the owner Notifications page reports configuration and delivery
   failures. `Accepted by Gmail` means provider acceptance, not proof of inbox
   delivery; confirm receipt when the first real assignment is sent. Missing
   configuration or a rejected token appears as a setup/failure status rather
   than silently approving content. Disable `EDITORIAL_EMAIL_ENABLED` to stop.

Merging into `develop` alone does not deploy production or switch on delivery.
The email template is bundled with the backend and needs no Supabase setup.

## Owner setup — no payment, no shared passwords

1. In Google Cloud Console, create/select a project **without linking billing**.
   Enable **Gmail API**. Stop if the console requires a purchase or card.
2. Configure Google Auth Platform branding/audience for your own sender account.
   While configuring in Testing, add that account as a test user. Request only
   `https://www.googleapis.com/auth/gmail.send`.
3. Create a **Web application OAuth client**. For a one-time operator setup,
   add Google's official OAuth Playground redirect URI:
   `https://developers.google.com/oauthplayground`.
4. Open [Google OAuth Playground](https://developers.google.com/oauthplayground),
   open its settings and choose **Use your own OAuth credentials**. Enter this
   client's ID/secret there privately, request the send-only scope, authorize
   using the intended Gmail sender, and exchange the authorization code for
   tokens with offline access. Never post those tokens or the client secret in
   GitHub, chat, screenshots or the browser application's environment.
5. Copy the refresh token, client ID and client secret into **backend secret
   variables**. Use the exact authorized Gmail address as `EDITORIAL_EMAIL_FROM`.
   These OAuth values are different from the Supabase SMTP app password; leave
   Supabase Auth SMTP and existing templates unchanged.
6. An external OAuth app left in **Testing** normally has refresh tokens that
   expire after seven days for Gmail scopes. For durable production delivery,
   configure the appropriate production publishing state and complete any
   verification Google requires. Do not bypass
   Google's consent/verification rules. Reauthorize after moving out of testing;
   revoke unused setup tokens. If account policy blocks this, keep delivery off
   and the review queue available rather than purchasing a service.

| Backend variable | Value / use |
| --- | --- |
| `EDITORIAL_EMAIL_ENABLED` | `false` during setup; `true` after the rollout steps above |
| `EDITORIAL_EMAIL_DASHBOARD_URL` | Exact HTTPS reviewer website origin; also listed in `ALLOWED_ORIGINS` |
| `EDITORIAL_EMAIL_FROM` | The Gmail account that authorized OAuth |
| `EDITORIAL_GMAIL_CLIENT_ID` | Your OAuth client's ID |
| `EDITORIAL_GMAIL_CLIENT_SECRET` | Secret, backend only |
| `EDITORIAL_GMAIL_REFRESH_TOKEN` | Secret, backend only |
| `EDITORIAL_EMAIL_TEST_RECIPIENTS` | Required only outside production: comma-separated authorized test reviewer addresses |
| `EDITORIAL_EMAIL_DAILY_CAP` | `40` (start smaller for testing); `0` prevents claims |

Set the same delivery configuration on the API (status/retry checks) and existing
`reminders` worker (delivery). Never prefix secrets with `VITE_` or `EXPO_PUBLIC_`.
Production sends only to currently eligible assigned reviewers; it does not use
`EDITORIAL_EMAIL_TEST_RECIPIENTS` as a recipient override. A receiver must have a
confirmed, active editorial account, an approved name and review permission.
Adding someone to Google's OAuth Test users does not create that reviewer account.

Optional future non-production environments require a test-recipient allowlist
and a separate database/Auth project as specified by #255; never point a test
worker at production. This isolation guidance is not a deployment prerequisite
for the direct production path selected here. Configuration-ready status is not
delivery evidence.

## Deployment checklist

- [ ] Apply ordered production migrations through **0038**, then run read-only
  schema verification before deploying the matching backend code. Update
  `migrations/applied.txt` only after actual production application is verified.
- [ ] Deploy the reviewer website over HTTPS, configure its API/Auth values,
  exact origins and Auth redirect URL, and set up the owner/reviewer accounts.
- [ ] Complete Gmail OAuth authorization with billing unlinked, using the sender
  account and only `gmail.send`. Replace any credentials exposed in screenshots.
- [ ] Move the Google OAuth application out of Testing as appropriate, complete
  any required Google verification, then obtain a fresh refresh token. Tokens
  issued while Testing are unsuitable for unattended long-term delivery.
- [ ] Store the current client ID, secret, refresh token and sender address on
  both API and reminders. Configure the exact dashboard origin and daily cap.
- [ ] Enable the editorial and email switches after those prerequisites. Confirm
  the deployed reminders worker runs every 15 minutes with the same revision.
- [ ] Record first real delivery/failure evidence when available. No staging
  environment or pre-merge staging mailbox test is required by this rollout.

The 48-hour deadline, 24-hour reminder interval and maximum two reminders remain
unchanged. Owner retry never resets the five-attempt budget. Automated tests use
fake providers; no real emails or production mutations are part of PR CI.

Rollback: set `EDITORIAL_EMAIL_ENABLED=false` on API and worker. The queue and
review actions remain usable; keep the additive migration/evidence. Do not
remove reviewed history or reset retry counters to work around failures. Fix
sender authorization, delivery quota or assignments using the documented paths.
