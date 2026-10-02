# Reviewer email notifications (#279)

Assigned reviewers receive batched links to lessons that need review. The queue
remains the source of truth, including when email is disabled or unavailable.
No email approves or publishes content. This is phase 6 of #263; deployment and
production activation belong to #281. The Auth sender track (#171/#152, draft
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

## When to enable

1. **Now:** prepare Google OAuth credentials and backend variables, leaving
   `EDITORIAL_EMAIL_ENABLED=false` and `EDITORIAL_EMAIL_STAGING_VERIFIED=false`.
   Merging this PR into `develop` does not activate production delivery.
2. **Staging:** deploy matching API, worker and reviewer website with migration
   0038 in the isolated staging database. Configure the test-recipient allowlist,
   enable email there and complete the inbox/link checklist below.
3. **Production:** release the backend changes through `develop` → `main`, with
   ordered migrations applied and verified before the new code starts. Deploy
   the reviewer website and confirm the existing reminders worker uses the
   matching revision and OAuth settings. Only after staging acceptance and
   durable sender authorization, set both email flags to `true` on the production
   API and worker. Production activation remains tracked in #281.

A feature merge is safe with sending disabled; it is not evidence that Gmail
credentials or inbox delivery work. No separate mobile APK update is needed for
these reviewer emails.

## Owner setup — no payment, no shared passwords

1. In Google Cloud Console, create/select a project **without linking billing**.
   Enable **Gmail API**. Stop if the console requires a purchase or card.
2. Configure Google Auth Platform branding/audience for your own sender account.
   For staging, add that account as a test user. Request only
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
   expire after seven days for Gmail scopes. That is staging-only, not a durable
   production setup. Before production, configure the appropriate production
   publishing state and complete any verification Google requires. Do not bypass
   Google's consent/verification rules. Reauthorize after moving out of testing;
   revoke unused setup tokens. If account policy blocks this, keep delivery off
   and the review queue available rather than purchasing a service.

| Backend variable | Initial staging value |
| --- | --- |
| `EDITORIAL_EMAIL_ENABLED` | `false` until below setup is complete |
| `EDITORIAL_EMAIL_STAGING_VERIFIED` | `false` |
| `EDITORIAL_EMAIL_DASHBOARD_URL` | Exact HTTPS reviewer website origin; also listed in `ALLOWED_ORIGINS` |
| `EDITORIAL_EMAIL_FROM` | The Gmail account that authorized OAuth |
| `EDITORIAL_GMAIL_CLIENT_ID` | Your OAuth client's ID |
| `EDITORIAL_GMAIL_CLIENT_SECRET` | Secret, backend only |
| `EDITORIAL_GMAIL_REFRESH_TOKEN` | Secret, backend only |
| `EDITORIAL_EMAIL_TEST_RECIPIENTS` | Comma-separated confirmed staging reviewer addresses |
| `EDITORIAL_EMAIL_DAILY_CAP` | `40` (start smaller for testing); `0` prevents claims |

Set the same delivery configuration on the API (status/retry checks) and existing
`reminders` worker (delivery). Never prefix secrets with `VITE_` or `EXPO_PUBLIC_`.
Non-production delivery requires the allowlist and never rewrites a real
recipient to another mailbox. Use a separate staging database/Auth project as
specified by #255; never point a staging worker at production. Only production
uses all eligible assigned reviewers; production also requires the explicit
staging-verification flag. Configuration-ready status is not delivery evidence.

## Staging acceptance / deployment handoff

These are real manual checks, not claimed completed by automated tests:

- [ ] Apply **0038** to the isolated staging database using the normal migration
  runbook, deploy API/worker from this PR and deploy the matching `admin/` build.
  Keep sending disabled until sender/origin/recipient settings are complete.
- [ ] Complete Gmail OAuth setup with billing unlinked; record provider/sender
  verification evidence without credentials. Enable email only in staging.
- [ ] Assign a staging lesson to an active, name-approved, confirmed reviewer.
  After the five-minute collection window and a cron tick, verify an actual
  inbox message, correct recipient, topic/count, timezone and deadline.
- [ ] Open its link signed out: require login/MFA; then see the assigned revision.
  Wrong/revoked accounts must not gain access. No approval occurs from the email.
- [ ] In staging only, temporarily shorten the interval to one hour and verify
  reminder behavior; restore 48/24/2. Approve/reassign while a batch is waiting
  and verify suppression. Confirm overdue work remains in the owner queue.
- [ ] Test an invalid/revoked OAuth token: sanitized failure appears; restore
  credentials and queue a retry before attempt five. Confirm learner Expo
  reminders still run normally.
- [ ] Record acceptance in this PR/#279; production activation stays with #281.

Production needs the ordered migration applied and read-only schema verification
before deploying code expecting these tables. Do not edit `migrations/applied.txt`
until actual production application is verified. No mobile/native change, APK,
app reinstall or learner release is needed for this reviewer-only feature.

Rollback: set `EDITORIAL_EMAIL_ENABLED=false` on API and worker. The queue and
review actions remain usable; keep the additive migration/evidence. Do not
remove reviewed history or reset retry counters to work around failures. Fix
sender authorization, delivery quota or assignments using the documented paths.
