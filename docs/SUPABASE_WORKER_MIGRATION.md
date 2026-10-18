# Supabase worker migration (#417)

This is the implementation and handover record for the second Railway exit PR.
It records verified live settings separately from source defaults. Keep provider
credentials, token values, URLs containing secrets, and recipient addresses out
of this document and Git history.

## Live Railway baseline (owner inspection, 2026-10-18)

| Service | Production command | Cron schedule (UTC) | Source | Restart |
| --- | --- | --- | --- | --- |
| `reminders` | `python -m app.workers.reminders` | `*/15 * * * *` | `Coding-Moves/one-concept`, `main` | Never |
| `pool-topup` | `python -m app.workers.pool_topup` | `0 22 * * *` | `Coding-Moves/one-concept`, `main` | Never |

Both services are in Singapore with a 2 vCPU / 1 GB ceiling and no public
domain. The owner saw successful **deployments** seven days before inspection;
this is not evidence that scheduled runs succeeded. At inspection the Railway
project showed eight days or $4.32 of remaining trial. The effective deployed
source revision, feature-flag values, latest Cron Runs, and `reminders` variable
names remain to be verified independently of this display.
The `pool-topup` service uses shared variable references for the Gemini,
generation, editorial email, and legacy-enrichment settings. Their values were
masked in the owner's capture and are not recorded here.

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
  handling; editorial email's bounded, at-least-once outbox; Expo batches of at
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
pushes, and editorial email are registered tasks; the other four provider tasks remain unavailable. No task can
run until its job is explicitly enabled.

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
| `editorial_generation` | 22:00 daily | First stage of pool-topup. |
| `legacy_enrichment` | 22:05 daily | Second stage of pool-topup. |
| `content_pool` | 22:10 daily | Final stage of pool-topup. |
| `prefetch` | Every five minutes | Demand signal is durable in `content_supply_targets`; the former process-local task cannot survive an Edge response. |
| `http-reconcile` | Every minute | New transport observation; checks HTTP status and expires stale dispatches. |

Before an inactive staging installation, configure these *only in staging*:

1. Database Vault secret `one_concept_worker_url` with the staging project's
   exact `https://<project-ref>.supabase.co/functions/v1/worker` URL.
2. A different, random secret of at least 32 characters saved as Database
   Vault `one_concept_worker_signing_key` and Edge Function secret
   `WORKER_DISPATCH_SIGNING_KEY`. The values must match exactly. Keep the
   secret out of SQL files, shell history, logs, GitHub comments and chat.
3. Run the protected `supabase-worker-staging-batch-*` workflow once the worker
   code is ready. One approval applies and verifies the worker migrations,
   deploys only the `worker` function, and installs eight inactive Cron jobs.
   Do not enable a job until its provider task and staging
   canary pass. Production uses its own different signing key and stays off
   until issue #418's cutover.

The request queue contains a run ID, job, issue time and HMAC. It contains no
Supabase service-role key or signing key. A readable queued signature can at
most race the legitimate request for that already-enqueued, one-use run; it
cannot authorize a new run. The Edge function stores only bounded counters.
`cron.job_run_details` means the SQL dispatch ran; `edge_worker_runs` records
the separate HTTP status and actual Edge completion. A 2xx HTTP result does
not mark a run succeeded unless the worker called its completion RPC.

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
idempotency key, so an unknown acceptance remains a bounded at-least-once
retry with a stable Message-ID.

Read-only operator checks after installation:

```sql
select jobname, schedule, active from cron.job
where jobname like 'one-concept-%' order by jobname;

select job, scheduled_for, status, http_status, error_code, result
from public.edge_worker_runs order by scheduled_for desc limit 30;
```

## Evidence still needed

- Railway Cron Runs and latest full deployed Git SHA for both services.
- `reminders` variable names, safe flag/cap values on both services, and
  effective root directory/start-command overrides.
- Whether any one-off maintainer command runs outside the two cron services.
- Staging credentials and allowlisted recipients for controlled push, Gmail,
  and Gemini canaries; do not copy production secrets into test logs or Git.

## References

- [Supabase Cron](https://supabase.com/docs/guides/cron)
- [Scheduling Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions)
- [Edge limits](https://supabase.com/docs/guides/functions/limits)
- [`pg_net` queued-header exposure](https://supabase.com/docs/guides/troubleshooting/database-roles-can-read-request-headers-queued-by-pg_net-ad6357)
- [Expo push delivery](https://docs.expo.dev/push-notifications/sending-notifications/)
