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
