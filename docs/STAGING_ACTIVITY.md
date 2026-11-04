# Staging project activity (#472)

The staging Supabase project is on the Free plan. Supabase may pause a Free
project after a week of low user database activity. Its [pausing guide](https://supabase.com/docs/guides/platform/free-project-pausing)
says a few real requests each day usually help, but does not guarantee that a
Free project stays available. A database trigger only runs while the database
is active; it cannot wake a paused project.

`.github/workflows/staging-activity.yml` makes an external, read-only request to
the staging Edge API's public `/health` route three times per day. That route
calls the database-backed `edge_api_health` RPC, and the job accepts only HTTP
200 with `{"status":"ok","database":"reachable"}`. It uses no account,
service-role key, email, or test data. The URL is fixed to the **staging**
project so this schedule never exercises production. GitHub runs scheduled
workflows from this repository's default `develop` branch; no production
release or SQL migration is needed.

## Activation and recovery

1. After this workflow reaches `develop`, run **Actions → Check staging database
   activity → Run workflow** once. Confirm the probe succeeds against the
   intended staging project. A PR check cannot establish this live result.
2. If the hostname does not resolve or the job reports a failed health check,
   inspect the staging project in Supabase. If it is paused, use **Resume
   project**, wait until it is healthy, then rerun the workflow. The job cannot
   resume a paused project itself. Check the staging API deployment if the
   project is active but `/health` fails.
3. Check the Actions history periodically. [GitHub may delay or drop scheduled
   runs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows);
   in public repositories it may disable schedules after 60 days without
   repository activity. Re-enable the workflow and rerun it when needed.

This is a best-effort activity check and failure signal, not an uptime promise.
For a production or staging project that must never auto-pause for inactivity,
use a [paid Supabase plan](https://supabase.com/docs/guides/platform/free-project-pausing).
If the staging project reference changes, update the fixed URL in the workflow
and verify the new host is distinct from production before merging.
