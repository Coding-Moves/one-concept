# Releasing One Concept

`develop` holds reviewed changes; `main` is production. Team code changes
normally merge into `develop`. The release is a reviewed `develop` → `main`
pull request. Do not merge a release PR without the owner's explicit approval
for that exact PR. Step 3's production operator sequence, evidence, and rollback
gates are in [the Supabase cutover runbook](docs/SUPABASE_CUTOVER.md).

## Required release diff

The release PR must contain a new `mobile/app.config.js` `expo.version` and a
nonempty matching entry in `mobile/src/data/whatsNew.ts`. The card describes
actual user-visible improvements and appears once per version until dismissed.
Verify both are present in the final PR diff against `main`. Keep
`runtimeVersion` unchanged for a JS-only release; native changes require a new
APK and the procedure in [mobile/DEPLOYMENT.md](mobile/DEPLOYMENT.md).

## Production sequence

1. Freeze source and record the current Railway API/worker SHAs, schedules,
   effective non-secret settings and expiry. Review Supabase capacity and
   billing, take a recoverable backup, and test restore separately.
2. Apply pending ordered SQL to the **production** Supabase project through
   the exact-tag, owner-reviewed cutover job after a verified backup. Verify
   actual objects and behavior, and only then append applied filenames to
   `backend/migrations/applied.txt`. The migration check's filename ledger is
   an operator record, not proof that SQL ran. Production schema verification
   remains protected and read-only.
3. Publish and test the separate static browser pages for confirmation,
   recovery, privacy and public profiles. Check production Auth redirect URLs,
   reviewer web configuration and both EAS public environments. Keep older
   Railway links alive until old emails and app bundles are accounted for.
4. Merge the reviewed release PR only with its specific owner confirmation.
   Railway auto deploy must be disabled beforehand. Run the protected
   `Deploy Supabase API and worker to production` workflow from **current main**.
   It verifies schema and project identity, deploys both Edge Functions, and
   checks API health. Then run the separately protected **Install inactive
   Supabase production Cron jobs** workflow, which verifies all eight jobs are
   inactive. Neither workflow repoints clients or starts scheduled work.
5. Smoke-test production with isolated accounts and a compatible preview app.
   The `Release` workflow requires the successful production deployment run ID
   and exact main SHA. It rejects a reused version tag, publishes preview OTA,
   then waits at a second protected approval before production OTA, release tag,
   and native-gated APK dispatch. Approve production OTA only after checking
   preview on a real device and the effective EAS environment values.
6. Hand over Railway Cron services to Supabase job by job as described in the
   cutover runbook. Disable each old executor first; read the Edge run ledger,
   not just pg_net's HTTP 200. Watch a complete cadence and the morning load
   before asking to retire Railway. Keep its API for older runtime clients.

The manual migration and release gates are deliberate. Merging code alone does
not change an installed app's EAS-bundled API URL, apply SQL or activate Cron.
Use the endpoint-only OTA procedure in the cutover runbook for a later URL
change; the release workflow rejects an already tagged app version.
