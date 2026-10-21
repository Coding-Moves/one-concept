# Supabase worker migration (#417)

This is the implementation and handover record for the second Railway exit PR.
It records verified live settings separately from source defaults. Keep provider
credentials, token values, URLs containing secrets, and recipient addresses out
of this document and Git history.

## Live Railway baseline (owner inspection, 2026-10-18–20)

| Service | Production command | Cron schedule (UTC) | Source | Restart |
| --- | --- | --- | --- | --- |
| `reminders` | `python -m app.workers.reminders` | `*/15 * * * *` | `Coding-Moves/one-concept`, `main` | Never |
| `pool-topup` | `python -m app.workers.pool_topup` | `0 22 * * *` | `Coding-Moves/one-concept`, `main` | Never |

Both services are in Singapore with a 2 vCPU / 1 GB ceiling and no public
domain. On October 20 the Railway project showed six days or $4.25 of remaining
trial. Both current deployment panels identify release PR #414. The owner
supplied its GitHub commit page, and PR #414's merge commit is
`c244088aa285127a3f065cc1d7e41afdae8bf36f`. This identifies the release
shown on the Railway cards; the cards do not display a full SHA themselves,
so step 3 should confirm the direct deployed revision before cutover.

The owner's Cron Runs panels show green `reminders` executions on October 20 at
15:16, 15:30, and 15:46 (GMT+5), lasting 7–9 seconds. Their deployment logs
show `sent 0, dropped 0 stale tokens` and `editorial email:
status=ready processed=0`; these are successful no-op runs, not proof of a
delivered push or email. `pool-topup` has green executions on October 18–20
around 03:02–03:04 (GMT+5), lasting 8–10 seconds. Its logs report generation
disabled, revision work empty, and legacy enrichment empty. They show the
work observed on those runs, but not every pending item or effective flag.
The `reminders` Variables panel uses all 17 shared variables. Its listed
service variables include the database/Supabase configuration, Gemini model
and caps, editorial email settings, and the standard seven Railway-provided
variables. The owner showed `EDITORIAL_EMAIL_ENABLED=true`,
`GENERATION_DAILY_CALL_CAP=200`, and `GEMINI_MODEL=gemini-3.1-flash-lite`
as effective `reminders` service values. On October 21 the owner also read
`EDITORIAL_EMAIL_DAILY_CAP=0` and `CONTENT_REVIEW_BACKLOG_LIMIT=30` from
Railway's production shared variables. A zero email cap prevents the existing
worker from claiming any batch even though `EDITORIAL_EMAIL_ENABLED=true`.
The new worker now defaults to a zero cap as well; step 3 must still explicitly
set the production cap to zero and keep its email gate closed unless the owner
deliberately changes the policy. Its recent runs processed no mail.
`WEEKLY_QUIZ_NOTIFICATIONS_ENABLED` is absent from this service and the
shared-variable inventory, so the deployed Python setting uses its
default `false`; the missing weekly log line agrees. The email cap was masked
in the earlier capture and subsequently supplied by the owner.
The `pool-topup` service uses shared variable references for the Gemini,
generation, editorial email, and legacy-enrichment settings. The owner read
`GENERATION_ENABLED=true` and `LEGACY_ENRICHMENT_ENABLED=true` from its live
Variables panel, plus `FUTURE_REFILL_ENABLED=false` and
`LEGACY_ENRICHMENT_BATCH_SIZE=25`. Both services reference the shared
`GEMINI_MODEL`, revealed as `gemini-3.1-flash-lite` in `reminders`. The logs show
no revision or legacy entry was processed; `nothing to do: generation disabled`
describes the refill pass and
does **not** mean the master generation flag is false. The owner could not find
pool-topup overrides for `GENERATION_DAILY_CALL_CAP` or
`GENERATION_PACE_SECONDS`; release commit `c244088` defaults them to 200 and
6.0 seconds when absent. Those two overrides were not visible to the owner in
the supplied Railway panel, so the defaults are the best available baseline;
step 3 must confirm their absence before enabling generation. Do not infer
them from no-op logs. `FUTURE_REFILL_ENABLED=false` keeps curated refill off.

## Responsibilities to preserve

| Existing path | Work that needs a Supabase owner |
| --- | --- |
| `workers/reminders.py` | Local-time daily reminders, weekly quiz notices and receipt checks, editorial Gmail outbox. |
| `workers/pool_topup.py` | Editorial revision jobs, legacy enrichment, active-reader supply planning, curated future refill, worker health. |
| `services/prefetch.py` | Request-triggered low-supply generation. Edge daily selection already records a durable supply target; a scheduled drain must replace the process-local task. |
| `workers/content.py` and other maintainer CLIs | Identify which commands are live operations and provide a protected manual replacement or retain a documented local command. |

## Design gates

- Create named `pg_cron` jobs through reviewed migrations, inactive in
  production until the third PR hands over ownership from Railway. Cron may
  enqueue short Edge requests through `pg_net`; record both the queued request
  and the eventual HTTP/worker result. Cron's own success only proves that its
  SQL command completed.
- Use a dedicated worker Edge endpoint with a short-lived, single-use signed
  request. Do not put a Supabase service-role key in `pg_net` headers: queued
  headers can be read by database login roles, even when the key came from
  Vault. Keep the signing key restricted in Vault and the Edge environment.
- Claims, quotas, recipient eligibility and run outcomes live in PostgreSQL.
  Commit a claim and provider reservation before network I/O, fence late
  completions, and bound each invocation to a small amount of work. A stopped
  Edge worker must leave recoverable durable state.
- Preserve daily reminder claim-before-send semantics; weekly push receipt
  handling; editorial email's bounded outbox and explicit review of uncertain
  delivery; Expo batches of at
  most 100; Pacific-day Gemini reservations; per-topic allowance; review
  capacity; and all existing kill switches. A provider's ambiguous acceptance
  cannot be reported as proven exactly-once delivery.
- Validate with disposable PostgreSQL and mocked providers, then staging test
  accounts/recipients. Production scheduled jobs stay inactive until the
  third PR's cutover. Record every activation, rollback and last successful run.

## Scheduler foundation and inactive installation

Migrations 0119–0120 create a service-only run ledger, one-use claim and
completion RPCs, a signed dispatch function, and HTTP result reconciliation.
The candidate `worker` Edge Function rejects unsigned, stale, oversized, or
unregistered work before any service-role RPC. Daily reminders, weekly quiz
pushes, editorial email, curated refill, editorial correction, and legacy
enrichment are registered tasks. No task can run until its job is explicitly
enabled.

`backend/ops/supabase_workers/0001_install_inactive_cron.sql` creates eight
named Cron jobs in one transaction, then verifies all eight are inactive. It
requires Supabase's `pg_cron`, `pg_net`, and `pgcrypto` extensions. The
application's separate `edge_worker_jobs.enabled` flag is also false by
default, so both gates must be deliberately opened for a job to dispatch.

| Cron job | Proposed UTC schedule | Existing Railway source |
| --- | --- | --- |
| `daily_reminders` | Every minute | Reminders every 15 minutes; shorter drain interval is needed for bounded Expo batches. |
| `weekly_quiz` | Every minute | Part of the reminders worker; up to 50 due learners and 100 Expo tokens per invocation. |
| `editorial_email` | 04, 19, 34, 49 each hour | Part of the reminders worker. |
| `editorial_generation` | Every two minutes | First stage of pool-topup, drained one private revision per invocation. |
| `legacy_enrichment` | Every two minutes, offset by one minute | Second stage of pool-topup, drained one owner-selected batch entry per invocation. |
| `content_pool` | Every five minutes | Plans active-reader demand and claims at most one curated title. The Pacific-day global and topic caps bound total provider calls. |
| `prefetch` | Every five minutes, offset by two minutes | Optional critical-supply pass. Demand is durable in `content_supply_targets`; the former process-local task cannot survive an Edge response. |
| `http-reconcile` | Every minute | New transport observation; checks HTTP status and expires stale dispatches. |

Before an inactive staging installation, configure these *only in staging*:

1. Save a new random 48-character value as GitHub environment secret
   `SUPABASE_STAGING_WORKER_SIGNING_KEY` in `supabase-staging`. Keep the value
   out of SQL files, shell history, logs, GitHub comments and chat.
   The staging `SUPABASE_STAGING_ACCESS_TOKEN` must be scoped only to this
   project with Edge Functions read/write and Edge Function Secrets read and
   read/write; the original deploy-only token cannot set Edge secrets.
2. Run the protected `supabase-worker-staging-batch-*` workflow. One approval
   applies and verifies the worker migrations, writes the key to staging Vault
   and Edge secrets, deploys only the `worker` function, and installs eight
   inactive Cron jobs. It sets the staging worker URL, existing session-pooler
   URL, `ENVIRONMENT=staging`, and `WORKER_GENERATION_TEST_ENABLED=false`.
   It then temporarily opens one disabled-provider job to prove signed dispatch
   and closes that gate again. This inactive installation does not copy any
   production provider secret.
3. Keep provider jobs off until controlled staging canaries pass. Production
   uses its own different signing key and stays off until issue #418's cutover.

The protected `supabase-worker-staging-batch-canary-*` tag runs one grouped
provider check after the inactive installation. It requires a test learner,
reviewer and owner in staging, one owner-approved test phone token copied into
the `SUPABASE_STAGING_TEST_PUSH_TOKEN` GitHub environment secret, and a reviewer
inbox the owner can open. Save the five temporary provider inputs as GitHub
`supabase-staging` environment secrets:

| Secret | Value source |
| --- | --- |
| `SUPABASE_STAGING_CANARY_GEMINI_KEY` | A Gemini key authorized for one private test draft |
| `SUPABASE_STAGING_CANARY_GMAIL_FROM` | The test sender's email |
| `SUPABASE_STAGING_CANARY_GMAIL_CLIENT_ID` | That sender's OAuth client ID |
| `SUPABASE_STAGING_CANARY_GMAIL_CLIENT_SECRET` | That sender's OAuth client secret |
| `SUPABASE_STAGING_CANARY_GMAIL_REFRESH_TOKEN` | That sender's Gmail refresh token |

The workflow refuses unexpected users, existing tokens, work queues, active
application gates or active Cron jobs. It seeds one pending reminder, quiz
notice, reviewer assignment and private editorial revision in a transaction,
then dispatches each job once with a one-call AI cap and one-email cap. All
provider values use worker-only `WORKER_CANARY_*` Edge settings; the shared
staging API configuration is untouched. The staging push text explicitly says
it is a test, and its weekly payload cannot open a staging quiz in the owner's
production phone app. The email also says it is a test and offers no live
review button; its `review.example.test` origin is deliberately inert. Only
the allowlisted phone and reviewer inbox can receive these deliveries. On
success or failure, the workflow closes every application gate, removes the
test token from staging tables, disables provider switches and removes the
temporary Edge credentials. The eight staging Cron schedules remain inactive.
Check the phone, inbox, worker run ledger and private draft before treating
the canaries as accepted. Delete the GitHub test push token secret afterward.

The first live provider batch on October 20 passed one daily push, one weekly
push, and one private editorial draft. The owner received a staging-labeled
phone notification. The Gmail batch made one attempt but sent no email:
Google rejected the sender's OAuth token exchange before the send call
(`sender_authorization`). The protected cleanup closed every application gate,
removed the staged phone token, and removed temporary Edge provider secrets.
The email acceptance item remains open. A protected
`supabase-worker-staging-batch-diagnose-*` tag reports only bounded staging
status/error codes. The first `supabase-worker-staging-batch-email-retry-*` run
reopened only the one unsent OAuth-rejected email batch for a second test
attempt and performed the same cleanup. It cannot retry an ambiguous Gmail
delivery or repeat the push/AI canaries. Keep the OAuth client ID, secret and
refresh token from the same Google client and sender account; [Google documents](https://developers.google.com/identity/protocols/oauth2)
seven-day refresh-token expiry for an External/Testing app.

The first email-only retry also failed before Gmail granted access. The
protected OAuth diagnostic then returned Google's `invalid_client` code; it
sent nothing. Replace both staging OAuth client values with the exact client
used to issue the refreshed token. The final email-only retry first checks
Google's token exchange, then applies any reviewed staging migrations and
reopens only the same unsent batch with exactly two prior authorization
failures. Its third attempt uses a three-message test cap and repeats neither
push nor generation. A failed preflight cannot reopen the batch.
The first protected run after replacing the GitHub client values still returned
`invalid_client` before applying SQL or sending mail. Check that the client ID
belongs to the OAuth Web client used in Playground and that its enabled secret
was copied exactly. Google [hides old client secrets after creation and permits
adding a new secret to the same client](https://support.google.com/cloud/answer/15549257);
keep the existing refresh token when rotating only that client's secret.

The corrected staging client passed a no-send OAuth exchange on October 21.
The guarded retry sent one test email; the owner found it in the controlled
reviewer mailbox's Spam folder. A separate protected reconciliation recorded
its HTTP 200 receipt without sending again. Migration 0130 then fenced
uncertain Gmail delivery from automatic retries. The final protected staging
batch verified all migrations through 0130, deployed the candidate worker,
confirmed eight Cron jobs inactive, and completed a signed dispatch with
generation disabled. Production still uses Railway; these results authorize
review of this migration PR, not activation of Supabase production jobs.

Migration 0128 updates the owner operations view and event feed. While every
Supabase worker application gate is off, the view continues to use Railway's
existing worker observations. When any Supabase worker is enabled, it reports
each named job's enabled state, latest run, failure and staleness from the
durable ledger. The event feed includes only job name, status, time and run ID;
provider response and recipient data remain private. The operator SQL below
also checks the independent Cron active gate and HTTP outcome.
Migration 0129 makes each HTTP reconciliation prune at most 1,000 terminal run
records older than 30 days. It never prunes queued or running work; this keeps
the ledger and owner event history bounded on the Free database tier.

The request queue contains a run ID, job, issue time and HMAC. It contains no
Supabase service-role key or signing key. A readable queued signature can at
most race the legitimate request for that already-enqueued, one-use run; it
cannot authorize a new run. The Edge function stores only bounded counters.
`cron.job_run_details` means the SQL dispatch ran; `edge_worker_runs` records
the separate HTTP status and actual Edge completion. A 2xx HTTP result does
not mark a run succeeded unless the worker called its completion RPC.

Curated refill uses migrations 0124–0125. The normal pass refreshes durable
active-reader targets; the optional urgent pass uses the same targets and
separate higher daily caps. Both reserve Pacific-day global and topic
allowances, check shared generation and review capacity, then fence one
backlog title before a single Gemini call. A timeout or failed call releases
the title for a bounded retry; a late completion cannot overwrite a newer
claim. Successful output is a private concept and revision draft, never a
published lesson. `GENERATION_ENABLED` and `FUTURE_REFILL_ENABLED` must both
be true to run. `FUTURE_REFILL_URGENT_ENABLED` independently controls the
critical-supply pass. Keep these three switches false in staging until the
provider test uses a dedicated test key and curated test titles.
All three generation tasks also require worker-only
`WORKER_GENERATION_TEST_ENABLED=true` outside production. The staging
deployment sets it to `false`, so a shared API flag cannot spend Gemini calls
through the worker before a controlled canary.

Editorial correction and legacy enrichment use migrations 0126–0127. Each
claim rechecks the requester's current membership and a shared Pacific-day
generation cap before a single provider call. Completion rechecks revocation,
source version and competing revisions under the account and catalog locks.
Only a complete private draft is staged; the existing human approval and
publication steps remain required. Legacy enrichment also requires an
owner-created running batch and Google grounding metadata with safe HTTPS
references; model-written reference URLs are ignored. The short recurring
schedules drain bounded work while its normal feature switches and per-batch
quota remain authoritative. A stopped worker is recovered by the 30-minute
claim reaper without allowing an old result to overwrite a newer claim.

Daily reminders use migration 0121's outbox. One Cron invocation enqueues due
local-time slots and sends at most 100 Expo tokens. It commits each token claim
before the network call; an unknown provider outcome stays unknown and is not
automatically resent. The claim checks the learner's current completion,
notification choice, active follows and handset ownership. A staging function
can reach Expo only for tokens listed in its `WORKER_PUSH_TEST_TOKENS` secret.
The list must contain test handsets only; unlisted tokens are blocked and
recorded without contacting Expo.

Weekly quiz pushes use migration 0122's existing quiz outbox and immutable
seven-question snapshot. The task enqueues at most 50 due learners and claims
at most 100 device tokens per minute, so a 500-learner due cohort can drain
within the 15-minute local 09:00 window. It checks Expo receipts separately;
only an explicit rejection can retry, while a send timeout remains unknown.
The task obeys `WEEKLY_QUIZ_NOTIFICATIONS_ENABLED=true`, and the same staging
handset allowlist applies. This cap assumes the average learner has no more
than one active token; extra tokens can continue sending until local 20:00.

Editorial Gmail uses migration 0123's existing assignment outbox. Each Cron
invocation groups at most ten reviewers, claims at most two batches, and honors
the rolling 24-hour `EDITORIAL_EMAIL_DAILY_CAP`. The send runs inside a direct
PostgreSQL transaction that holds the same account, catalog, and notification
locks as editorial access changes. A revocation therefore wins before send or
waits until the already-started send finishes. The Edge function needs a
`WORKER_DATABASE_URL` secret set to this project's **session pooler** URL on
port 5432. It rejects a URL for another project or pooler mode. The address,
password, Gmail OAuth values, and test recipient list belong only in Edge
secrets, never in Git or logs. `EDITORIAL_ENABLED` and
`EDITORIAL_EMAIL_ENABLED` must both be true before this task runs; in staging,
`EDITORIAL_EMAIL_TEST_RECIPIENTS` must name only controlled addresses and the
dashboard origin must be listed in `ALLOWED_ORIGINS`. Gmail has no send
idempotency key. Migration 0130 marks an expired `sending` lease as
`failed/delivery_unknown` and excludes it from automatic claims. The worker
also marks a send timeout, 5xx response, or unreadable success response as
`failed/delivery_unknown`; these outcomes require checking Gmail Sent and the
recipient mailbox before a human decides whether another send is appropriate.
OAuth token-exchange failures occur before the send and remain retryable.
This avoids an automatic duplicate after a worker restart, but it cannot prove
exactly-once delivery when the provider outcome is unknown. An owner can use
the existing version-checked notification retry action after investigating the
sender's Sent folder and the recipient mailbox; never requeue the row blindly.

Read-only operator checks after installation:

```sql
select jobname, schedule, active from cron.job
where jobname like 'one-concept-%' order by jobname;

select job, scheduled_for, status, http_status, error_code, result
from public.edge_worker_runs order by scheduled_for desc limit 30;
```

For a single redacted status snapshot, run
`backend/ops/supabase_workers/0002_operator_status.sql` in the target project's
SQL Editor. It reports both scheduler and application gates, last completed
run, HTTP result, 24-hour failures, queue counts, and Pacific-day Gemini use.
Inspect the corresponding Edge Function logs when a run has `task_failed`,
`ledger_unavailable`, a non-2xx HTTP status, or no success across two expected
schedule intervals. Do not treat a green Cron row as evidence that push, email,
or generation completed. Alert on persistent failed/timed-out run counts,
`sending` entries older than their lease, `failed` or `blocked` generation
entries, and any production worker job active before the cutover.

During step 2, all eight staging Cron rows and seven application jobs remain
disabled. The step-3 operator will enable each reviewed job deliberately after
Railway ownership is stopped. To stop new work quickly, deactivate the named
Cron jobs and set the corresponding `edge_worker_jobs.enabled=false` in one
reviewed SQL transaction; check `active_run_id` and recent runs before treating
an already-started provider call as stopped. Turning a gate back on does not
replay unknown Expo/Gmail outcomes. Retrying a rejected weekly push or a failed
editorial mail batch follows their existing bounded outbox states; a `sending`
timeout marked `unknown` requires human investigation before any retry.
Generation failures retain durable attempt counts and an explicit reviewer or
owner action can request a new job; never reset a failed entry directly in SQL.

The two scheduled Railway processes inspected so far are `reminders` and
`pool-topup`. The separate maintainer CLIs are **manual**:
`app.workers.content` imports curriculum, reports health, stages a revision,
and requests a bounded retry; `app.workers.editorial_review` invokes
authenticated editorial API actions; `app.workers.editorial_accounts` bootstraps
owner membership; `app.workers.rewrite_catalog` is a one-off rewrite; and
`app.workers.schema_check` verifies schema. They are not Cron jobs. An operator
can run their existing protected commands from a local checkout against the
selected Supabase database after confirming the project ref; no Railway service
is needed. Publication and rejection must use the authenticated editorial
actions, as the content CLI itself refuses free-text decisions. The working
commands and data paths were checked against their source entry points and the
two Railway cron commands. Whether an operator also runs any of them outside
Railway remains a step-3 cutover confirmation.

## Production queue snapshot (owner inspection, 2026-10-21)

The owner ran this read-only aggregate in the production Supabase SQL Editor.
Every returned count was zero: pending/generating editorial jobs, pending/sending
email batches, unbatched unsuppressed email outbox entries, pending/retry/sending
weekly pushes, and pending/generating curated backlog. This is a point-in-time
snapshot, not proof that the queues will remain empty at cutover. The Railway
daily reminder path calculates due users on each invocation and has no separate
pending outbox to count.

The aggregate used was:

  ```sql
  select
    (select count(*) from public.editorial_generation_jobs
      where status in ('pending','generating')) as editorial_jobs,
    (select count(*) from public.editorial_email_batches
      where status in ('pending','sending')) as email_batches,
    (select count(*) from public.editorial_notification_outbox
      where batch_id is null and not suppressed) as unbatched_email,
    (select count(*) from public.weekly_quiz_notifications
      where status in ('pending','retry','sending')) as weekly_pushes,
    (select count(*) from public.concept_backlog
      where status in ('pending','generating')) as curated_backlog;
  ```

The separate step-3 cutover must recheck queue counts and the two unconfirmed
pool-topup overrides against the live services before it enables a provider
job. Keep generation and email gates closed until their effective caps are set.

## Step-3 activation checks

- Explicitly preserve `EDITORIAL_EMAIL_DAILY_CAP=0` and
  `CONTENT_REVIEW_BACKLOG_LIMIT=30` in the destination configuration. The
  current zero cap blocks production editorial email; do not turn on its email
  gate without a separate policy decision. The worker's fallback is also zero.
- Verify that pool-topup has no `GENERATION_DAILY_CALL_CAP` or
  `GENERATION_PACE_SECONDS` override. Source defaults are 200 calls and 6.0
  seconds only if those variables are truly absent. Recount all five production
  queues immediately before changing job ownership.
- Confirm the Railway deployment cards' direct full Git SHA, root directory,
  and command overrides before stopping either service. The release shown on
  both cards matches PR #414's merge commit, but the SHA itself is not shown.
- Confirm whether any out-of-band maintainer command is routinely run outside
  the two inspected Railway cron services. The known maintainer CLIs remain
  documented manual paths.
- The protected October 21 Gmail OAuth check passed token exchange. The guarded
  staging email retry recorded one sent batch and `sent=1` in the worker; the
  owner found it in the controlled reviewer mailbox's Spam folder. A protected
  reconciliation of the existing `pg_net` receipt recorded HTTP 200, without
  dispatching or sending again. Before production
  editorial email is enabled, check sender authentication and placement with a
  real controlled production-domain message.
- The OAuth client secret and refresh token appeared in owner-shared diagnostic
  screenshots. Rotate those credentials before production email activation if
  the same values are used there; save replacements only in the destination
  secret store and verify a no-send token exchange first.

## References

- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Edge limits](https://supabase.com/docs/guides/functions/limits)
- [`pg_net` queued-header exposure](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)
- [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/)
