# Supabase production cutover (issue #418)

This is an operator checklist for the existing production Supabase project
`egdszjoesxlccauahmsx`. The candidate was tested in staging project
`zhrulokgngjceqgjkcmw`. **Merging code does not apply SQL, enable Cron, change
an installed app's API URL, or retire Railway.** Record the date, main SHA,
operator, and result of each gate in the release PR. Stop at a failed gate.

## 1. Freeze and measure before any production write

1. Verify Railway `api`, `reminders`, and `pool-topup` deployment SHAs and last
   successful runs. `reminders` currently runs every 15 minutes and
   `pool-topup` at 22:00 UTC; a successful deployment is not proof that a job
   did useful work. Record the expiry/billing date. Disable Railway **auto
   deploy from `main`** for all three services before merging the release PR,
   while leaving their current deployments and schedules running.
2. Read the current production Supabase database size, Storage size, monthly
   egress, Edge invocations, and connection utilization. Estimate monthly Edge
   calls as `daily active users × API calls per user per day × 30 + worker calls`.
   At 500 users and 30 API calls each day, API traffic alone is 450,000 calls
   monthly. Compare that with the **current** plan and limits before promising
   that this remains free. One staging test account and 500 read calls do not
   establish a 500-user production capacity guarantee.
   On October 21, the owner reported production project `egdszjoesxlccauahmsx`
   on the Free plan with a 25 Sep–25 Oct billing cycle: database 0.033 GB
   (31.94 MB), Storage 0 GB, egress 0.099 GB, 5 MAU, and 1 Edge invocation.
   These are a pre-cutover baseline while Railway still handles API traffic.
   At the stated 500-user scenario, 450,000 API calls in 30 days leave only
   50,000 of the documented 500,000 Free Edge invocations for worker dispatch,
   retries, admin traffic, and bursts; a 31-day month would use 465,000 API
   calls. Measure actual calls per user and upgrade or reduce load before the
   quota is approached. Connection utilization was not supplied.
3. Take a recoverable production database backup, record its timestamp and
   restore instructions, and complete a restore drill in a separate disposable
   target. Supabase Auth and Storage also need a recovery plan. Keep credentials,
   backups, and user records out of GitHub logs and the PR. Capture current
   queue counts and production settings; the owner observed all five queues at
   zero on October 21, but that snapshot must be refreshed at handover.
   Supabase's Free plan does not include automatic daily backups; use the
   [documented CLI dump/restore procedure](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
   if there is no managed backup. A database dump contains Storage metadata,
   not the stored file objects. Do not claim a restore drill passed from the
   presence of a dump file alone.
4. Rotate the Gmail OAuth client secret and refresh token previously exposed
   in screenshots before enabling production email. A staging email arrived in
   Spam; successful Gmail HTTP acceptance alone does not prove inbox delivery.

Sources for the changing platform limits and behavior: [Supabase Edge pricing](https://supabase.com/docs/guides/functions/pricing),
[Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase),
and [Expo update deployment](https://docs.expo.dev/eas-update/deployment/).

## 2. Apply SQL to the existing production database

The production `backend/migrations/applied.txt` ledger records through 0130 after
the protected SQL run and independent read-only verification on October 21, 2026.
The owner-approved one-time job applied 0046–0130 in filename order to the
existing production project. There was no user-data copy between staging and
production. **Do not rerun that SQL job**: its 0045-baseline guard will reject
the now-migrated database. For later migrations, take and test a fresh backup,
apply only the new ordered files through a separately reviewed procedure,
verify the live schema, and then update the ledger.

The protected production schema verifier passed after application. It confirmed
the `edge_api_*` and `edge_worker_*` RPCs, the `edge_worker_jobs` ledger, and
the final email ambiguity fix before the verified filenames were appended to
`applied.txt`. The ledger is an attestation, never a way to make CI green.
Before release, recheck the actual production schema against the exact proposed
main SHA. Keep all production Cron jobs inactive during this phase.

## 3. Configure production without opening job gates

1. In the existing protected GitHub `production-schema` environment, set
   `PRODUCTION_SCHEMA_DIRECT_URL` and a **production-project-scoped**
   `SUPABASE_PRODUCTION_ACCESS_TOKEN`. Set production environment variables
   `SUPABASE_PRODUCTION_PROJECT_REF=egdszjoesxlccauahmsx` and
   `SUPABASE_STAGING_PROJECT_REF=zhrulokgngjceqgjkcmw` (both are now set).
   Keep values out of
   chat, logs, and source. The production deploy workflow rejects another
   target and a token missing from the protected environment.
2. Configure production Edge secrets for the API and worker from the current
   Railway effective settings, with `ENVIRONMENT=production`. The worker
   requires `WORKER_DATABASE_URL` (the **production** session pooler at 5432)
   and a new `WORKER_DISPATCH_SIGNING_KEY` of at least 32 random characters.
   Save the same signing key in production Supabase Vault as
   `one_concept_worker_signing_key`; save the exact production worker URL in
   Vault as `one_concept_worker_url`. Use a private channel to set them and
   verify the production project reference before every write. Do not copy
   staging credentials into production.
   The owner supplied a names-only screenshot on October 21 showing these
   custom production Edge secrets saved: `ENVIRONMENT`, `ALLOWED_ORIGINS`,
   `EDITORIAL_EMAIL_ENABLED`, `EDITORIAL_EMAIL_DAILY_CAP`,
   `FUTURE_REFILL_ENABLED`, `WEEKLY_QUIZ_NOTIFICATIONS_ENABLED`,
   `CONTENT_REVIEW_BACKLOG_LIMIT`, `GENERATION_DAILY_CALL_CAP`, and
   `GEMINI_MODEL`. The displayed SHA-256 digest prefixes match the intended
   values: `production`, the Netlify reviewer origin, `false`, `0`, `false`,
   `false`, `30`, `200`, and `gemini-3.1-flash-lite`, respectively. This checks
   saved values without revealing them; live function behavior is still to be
   tested after deployment.
   After that screenshot, the owner reported saving `WORKER_DATABASE_URL` from
   the existing production session-pooler connection string and saving the
   same fresh `WORKER_DISPATCH_SIGNING_KEY` in Edge Secrets and production Vault.
   The owner also reported saving `one_concept_worker_url` in Vault. These
   private values have not been independently read back or exercised; the
   protected worker boot check and a signed production canary must verify them
   before enabling any scheduled job.
3. Match the observed production flags before enabling any worker. Known
   baseline: `FUTURE_REFILL_ENABLED=false`,
   `LEGACY_ENRICHMENT_BATCH_SIZE=25`, `CONTENT_REVIEW_BACKLOG_LIMIT=30`,
   `EDITORIAL_EMAIL_DAILY_CAP=0`, and weekly quiz notifications absent (so
   disabled). `reminders` reported `GENERATION_DAILY_CALL_CAP=200` and
   `GEMINI_MODEL=gemini-3.1-flash-lite`; check effective values on all relevant
   services rather than guessing. Keep email disabled until OAuth rotation,
   recipient tests, and a nonzero cap are deliberately approved.
4. Install `backend/ops/supabase_workers/0001_install_inactive_cron.sql` only
   after the worker SQL and Vault secrets are verified. It installs seven work
   schedules plus HTTP receipt reconciliation, and fails unless all eight are
   inactive. [Supabase Cron](https://supabase.com/docs/guides/cron/quickstart)
   overwrites a job with the same name, so this one-time installer refuses
   existing One Concept jobs, including those activated during handover. Read
   back `cron.job` by name and active state. Do not turn on provider or job
   switches in a bulk edit.

Supabase [does not serve HTML from GET Edge Function responses](https://supabase.com/docs/guides/functions/development-tips).
Before merging, verify that the `admin/` Netlify site's production build still
uses its current Railway `VITE_API_URL`, the production Supabase Auth URL, and
its **publishable** key. Check the generated HTML and security headers locally.
On October 21, the current public site bundle exposed only the expected hostnames:
`one-concept-production.up.railway.app` for API traffic and
`egdszjoesxlccauahmsx.supabase.co` for Auth. This confirms the published
origins, not Netlify's private settings or the correctness of its publishable
key.
This site's deploy previews are canceled by policy, so the new routes cannot be
verified on the live host before this PR reaches `main`. After merging, publish
the exact `main` commit on Netlify with Railway still configured and confirm
`/privacy`, `/confirmed`, `/reset-password`, and `/p/{token}` return HTML with the
generated security headers. The profile page displays only public JSON.
Only then add the new `/confirmed` and `/reset-password` URLs to production
Supabase Auth's redirect allowlist; retain older Railway redirect URLs while old
emails and app bundles can still use them. Test confirmation, recovery, shared
profiles and revocation in an isolated production test account before repointing
mobile clients. Netlify [200 rewrites](https://docs.netlify.com/manage/routing/redirects/rewrites-proxies/)
keep the public path in the address bar.

## 4. Deploy exact code, test preview, then switch clients

1. After the production ledger, backup, capacity, Edge/Vault configuration,
   current Netlify build settings, and local browser-page checks pass, merge the reviewed
   release PR only with the owner's specific merge approval. Keep Railway auto
   deploy disabled. The release PR must contain a version bump and matching
   What's New card; the prepared version is 1.10.15 with
   native runtime 1.10.8 unchanged.
2. Publish and verify the four live Netlify pages as described above. Keep the
   existing Railway API and app routing in place if any page fails; correct the
   site before changing Auth redirects or mobile URLs.
3. Run **Deploy Supabase API and worker to production** on `main`. Approve its
   existing `production-schema` protected environment. It rejects a noncurrent
   SHA or another project, reads actual SQL schema, deploys both functions
   from that exact main commit, checks the API `/health`, and requires the worker
   to reject an unsigned dispatch with its own 401 response. Record its Actions
   run ID and main SHA. This does not activate Cron or repoint clients.
4. Verify authenticated learner, reviewer and owner flows, avatar, public
   profile, recovery, health, and an isolated worker dispatch. Check function
   logs for 429/503, database connections, latency, quota and Edge usage. Keep
   `EDITORIAL_EMAIL_DAILY_CAP=0` until production sender delivery is observed.
5. Change only Netlify's production `VITE_API_URL` to
   `https://egdszjoesxlccauahmsx.supabase.co/functions/v1/api`, redeploy that
   site, and repeat its reviewer and public-profile checks. Its Supabase Auth URL
   and publishable key must still belong to that same production project. Keep
   mobile clients on Railway until the preview canary passes.
6. In EAS `preview`, set the exact API function URL and a separately hosted
   `EXPO_PUBLIC_WEB_BASE_URL` (the static site's HTTPS origin). Keep Auth keys
   pointing to the **same** production Supabase project for a production canary
   or all to staging for a staging canary. Never mix project URLs/keys. Test a
   compatible preview app on a real phone, including sign-in, lesson writes,
   reset, profile share, offline replay, and reminders. The source code cannot
   prove what EAS environment is configured; check it before publication.
7. The `Release` workflow requires the successful production deployment run
   ID and matching main SHA, checks actual schema and the unused release tag,
   publishes preview OTA first, then waits for a **second protected approval**.
   Approve that second gate only after testing the preview update and verifying
   `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_WEB_BASE_URL`, Supabase Auth URL/key,
   app version and runtime in both EAS environments. Production OTA then
   publishes and the workflow creates the release. Installed app adoption must
   be observed; older runtimes may still call Railway.

## 5. Hand over scheduled jobs without duplicate runs

Railway `reminders` includes daily reminder, weekly quiz, and reviewer email
work. Disable its schedule **before** activating any corresponding Supabase
job. Verify it stopped, then activate `one-concept-http-reconcile` and the
needed reminder jobs one at a time. Weekly quiz remains disabled if the flag
is absent. Email remains disabled while its cap is zero or sender delivery is
unverified. Wait for a full cadence and inspect `edge_worker_runs`, HTTP
receipts, outbox state, and actual controlled-device/inbox delivery.

Railway `pool-topup` includes curated refill, editorial generation, legacy
enrichment, and prefetch. Disable its schedule **before** enabling the
corresponding Supabase jobs. Enable one at a time, matching provider switches,
limits and review backlog. Avoid a simultaneous old/new generator because
it can consume provider quota or create duplicate private work. Compare output
counts with the captured baseline and check failed/ambiguous rows manually.

An HTTP 200 from pg_net proves receipt, not successful job completion; read
the worker run ledger. For any job failure, deactivate its `cron.job`, keep its
provider gate closed, inspect the queued item and run status, then choose the
documented Railway rollback only after confirming a second executor will not
process the same work. Do not automatically retry an email marked
`delivery_unknown`: Gmail may already have accepted it.

## 6. Observe and retire Railway

Record at least one full reminder cadence, one full pool-topup cadence, a
morning burst, representative phone/browser flows, and the production database
and Edge metrics. Verify no current client, recovery link or public profile
depends on Railway. Keep the old API reachable for older runtime versions until
their update path and link expiry are accounted for. Only then obtain explicit
owner confirmation for the specific Railway service shutdown/deletion and its
rollback consequences. Closing Railway before that evidence risks stranding
installed clients; retaining it past the credit expiry requires a separate cost
decision.

Rollback is by component: deactivate the affected Supabase Cron job before
reactivating its Railway counterpart; republish the last known good OTA from a
verified main commit for client routing; preserve the old API while that OTA
propagates. SQL migrations are forward-only, so restore a verified backup to
a separate project before deciding on any destructive database rollback.
