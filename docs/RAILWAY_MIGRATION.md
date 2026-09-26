# Railway account migration

Runbook for [issue #230](https://github.com/Coding-Moves/one-concept/issues/230).
This moves hosting while retaining the existing Supabase database, Auth project,
Expo project, Android package/signing credentials, and application behavior.
Merging this document does not change Railway or EAS configuration.

## Current evidence, 2026-09-26

| Item | Evidence / remaining work |
| --- | --- |
| Source project | `7a95ffc3-8b7f-461b-b554-b9953b94b709` |
| Destination project | `5cf2f8fa-591f-4844-9bb7-09726be4ecc4` |
| Old API | `https://api-production-f3a9f.up.railway.app` |
| New API | `https://one-concept-production.up.railway.app` |
| New API health | Public GET `/health`: HTTP 200, `status=ok`, `database=reachable` |
| Destination trial | Owner reports Full Trial; screenshot showed 30 days or $5, not a guaranteed 30 days of service |
| Reminders | Import-only test passed; owner reports real-run logs are fine. Record actual run outcome and confirm old worker stopped before sign-off |
| Pool top-up | Import-only test passed; owner confirms new `GENERATION_ENABLED=false`. Successful generation and old-worker handover are pending |
| EAS endpoint | Direct read of production and preview variables shows both still use the old API |
| Mobile runtime | Released app/runtime 1.10.0; older runtime 1.3.0 installations need a separate compatibility decision |
| Publication / retirement | No endpoint OTA published and no source-project deletion performed as part of this work |

The new API is service `63e0dfd6-99b9-432b-8747-d578d3d07789`; reminders is
`0341bb11-51bc-4ec8-8ea0-fc98c5d4dbc2`. Deployment screenshots include short
deployment identifiers, which are not sufficient proof of Git commit identity.
Record the full deployed Git SHA from each service's source details.

## Account and data prerequisites

- Confirm destination account recovery, actual plan, credit expiry, quota and
  network access. A university email alone does not guarantee trial eligibility.
- Direct ownership transfer currently requires active Hobby or Pro plans on both
  sides. This runbook uses a parallel rebuild, not that transfer procedure.
- Inventory source start/build commands, schedules, regions, Git revisions,
  domains, volumes and environment variable names. Keep all values out of Git,
  screenshots and issue comments. Copy actual values privately; old-project
  `${{...}}` references must be recreated or resolved in the destination.
- Verify backup/restore readiness and existing migration state. Reuse Supabase;
  do not create a replacement database, rerun applied SQL, change user IDs or
  rotate database credentials just to move hosting.
- Keep the source API usable until clients and recovery links have transitioned.

## Service configuration

All three services use `Coding-Moves/one-concept`, branch `main`, root `/backend`,
and the backend Dockerfile. Pin or verify the same release revision on all three;
avoid unrelated deployments during handover. Initially match the existing
Singapore region and resource ceilings (2 vCPU / 1 GB); tune from actual usage.
Verify proximity to the Supabase region before changing locations.

| Setting | API | Reminders | Pool top-up |
| --- | --- | --- | --- |
| Start command | Dockerfile default (Uvicorn) | `python -m app.workers.reminders` | `python -m app.workers.pool_topup` |
| Cron after handover | None | `*/15 * * * *` | `0 22 * * *` |
| Healthcheck | `/health`, timeout 30 seconds | None | None |
| Restart policy | On Failure, 3 retries | Never | Never |
| Public domain | HTTPS API domain | None | None |
| Serverless | Off during migration | Not applicable to cron | Not applicable to cron |

Cron expressions are UTC. Pool top-up at 22:00 UTC runs at 03:00 Pakistan time
the next day. Reminders checks due user-local slots every 15 minutes; it does
not send everyone a notification each time it runs. Cron jobs exit after work;
Completed/Ready between runs is normal.

Keep custom build commands and pre-deploy commands empty. Railway detects
`Dockerfile` in the configured source root. If a dashboard field explicitly asks
for a repository-absolute Dockerfile path, use `/backend/Dockerfile`.
New services cannot opt into legacy `railway.json` / `railway.toml` Config as
Code. Enter the settings directly; in particular, do not inherit the API's
HTTP healthcheck or restart policy for workers. Existing source services may
still have configuration overrides, so inspect effective deployment settings.

Use `ENVIRONMENT=production`. Preserve source variables for each service,
especially Gemini model, pool size, generation caps and pace. Keep generation
off on the replacement during preparation. Preserve the original enabled value
separately; never silently turn a deliberately disabled generator on.

## Prepare workers without executing production jobs

Set the temporary command before attaching source/applying deployment changes:

```sh
python -c "import app.workers.reminders; print('Reminder worker imports OK; no notifications sent')"
```

For pool top-up:

```sh
python -c "import app.workers.pool_topup; print('Pool top-up imports OK; no generation started')"
```

Leave cron and healthcheck blank, with Never restart. These commands validate
imports only: they do not prove database access, Gemini availability, Expo push
delivery or successful job execution. A blank cron is not a job kill switch:
deploying a service can run its start command immediately. Also,
`GENERATION_ENABLED=false` does not disable reminders; a real pool-topup run can
still write demand/worker bookkeeping even when generation is disabled.

Before handover, check each destination's effective database configuration and
external connectivity. An optional `SELECT 1` check is read-only; neither
import success nor successful health on a different service proves its variables
were copied correctly. Never claim skipped checks as passes.

## Worker handover and rollback

For one worker at a time, record its original command, schedule and enabled
state. Let any existing run finish. In the source service, stage both an empty
cron and a harmless start command such as:

```sh
python -c "print('Old worker disabled')"
```

Apply with Never restart and no HTTP healthcheck. Confirm effective settings,
the harmless command's log, and absence of an in-flight original worker. Check
for Config-as-Code overrides on old services. Then set the real command and
matching cron on the destination. Restore the original generation-enabled value
only on the intended generator; keep model/caps unchanged. Activation may run
the job immediately, including production notifications or Gemini calls.

Inspect the first real run and scheduled runs. A reminder count of zero can be
valid but does not prove handset delivery: test a due reminder on an owner test
account and verify completion suppresses subsequent reminders. For pool top-up,
inspect its generated/failed/skipped outcome and content operations state.
Import-test logs must not be substituted for these results.

If a replacement fails, stop its scheduling and wait for active jobs to end,
then restore source settings. Do not run two independent schedules during
rollback or restore a database backup merely to undo a hosting change.

## Mobile endpoint and password recovery

The app reads `EXPO_PUBLIC_API_BASE_URL` from its JavaScript bundle. Updating an
EAS environment value alone does not change installed apps: an update/build must
be published with that environment. No native change is required solely for
this endpoint change, and `runtimeVersion` must stay unchanged.

1. Keep both APIs available. Verify source revision and the new API's health,
   protected endpoints, sign-in, lesson completion/history/achievements, privacy
   page and account isolation using an owner-controlled test account.
2. In the existing Supabase Auth URL configuration, add the exact new recovery
   URL `https://one-concept-production.up.railway.app/reset-password`. Retain the
   old recovery URL during transition, including for already-issued email links.
   Verify the new API has the required Supabase anon key. Test a recovery flow
   end to end; a successful health check does not cover password recovery.
3. Inspect any web CORS origins, GitHub monitoring/keepalive URLs and other
   external consumers. Update them explicitly; do not assume changing Expo
   changes those systems. Do not publish backend credentials to mobile.
4. In EAS **preview**, change only `EXPO_PUBLIC_API_BASE_URL` to
   `https://one-concept-production.up.railway.app`. Preserve all Supabase values.
   Check whether the variable is shared across environments before editing so
   production is not changed unintentionally. Publish/test the same verified
   production code on a compatible preview build, or use an isolated test export
   if no compatible preview installation is available.
5. After the owner verifies the candidate, change the **production** endpoint
   and publish the compatible OTA from the verified, clean production revision.
   Record source SHA, channel, runtime, environment, update group and test results.
   Preserve unrelated native/runtime/version/What's New configuration for this
   endpoint-only operational update. Follow the procedure in RELEASING.md below.
6. Cold-launch/relaunch a production device online as needed for update download
   and application. Confirm requests reach the new API and learning still works.
   Update downloads are not instantaneous across all devices.

An OTA for runtime 1.10.0 cannot reach runtime 1.3.0. Either distribute the
current compatible APK (an in-place Android update when package/signing permit),
or separately validate an endpoint-only OTA from the original older-runtime
source and dependencies. Never relabel current native code with the older runtime
to force compatibility. Offline users and fresh installs of an older embedded
bundle can also retain the old URL until a compatible update is loaded.

Rollback must address both EAS configuration and published bundles. Restore the
old variable and republish/roll back a known compatible update that points to the
old API. A server-side variable rollback alone cannot rewrite installed bundles.
Keep the old API available for that path and verify its recovery URL still works.

## Retirement gate

Do not declare migration complete based only on green deployment cards.

- Record identical intended source SHAs, healthy API, confirmed worker ownership,
  an actual scheduled reminder outcome and the daily pool-topup outcome.
- Confirm generation enabled/disabled behavior matches the source intentionally.
- Verify sign-in, reads/writes, offline replay and password recovery against the
  new API, plus a physical reminder with an owner test account.
- Record the production OTA group and device verification; account for all
  supported native runtimes and remaining old-URL requests. Observe a full daily
  cycle, not just startup success.
- Review source API requests and external consumers. Absence of traffic in a
  short window does not prove dormant/offline users have migrated. If an old URL
  cannot be retained, make the remaining-user impact an explicit owner decision.
- Confirm database recovery readiness and preserve required configuration/records
  privately. Keep Supabase intact; deleting Railway must not delete the database.
- After presenting this evidence and any remaining impact, obtain the owner's
  final approval for deletion of the exact source project above. Delete/cancel
  only that source project's obsolete resources, then verify no remaining charges
  or forgotten workers. Do not delete the destination or cancel its account.

Until this gate is met, keep issue #230 and its PR open with pending work visible.

## References

- [Railway trials](https://docs.railway.com/pricing/free-trial)
- [Project transfers](https://docs.railway.com/projects#transferring-projects)
- [Dockerfile builds](https://docs.railway.com/builds/dockerfiles)
- [Legacy Config as Code](https://docs.railway.com/config-as-code)
- [Cron jobs](https://docs.railway.com/cron-jobs)
- [EAS environment variables](https://docs.expo.dev/eas/environment-variables/)
- [EAS updates](https://docs.expo.dev/eas-update/deployment/)
- [Release procedure](../RELEASING.md)
- [Content operations](CONTENT_OPERATIONS.md)
