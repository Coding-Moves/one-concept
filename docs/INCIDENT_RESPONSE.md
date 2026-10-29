# Incident response

Use this guide when learners cannot reach One Concept or a production dependency
is unhealthy. It is an operator guide: never paste service credentials, user
emails, JWTs, database URLs, or raw exception text into an issue, chat, or
status message.

## Learner experience

The mobile app keeps cached lessons and queued learning actions on the device.
A request failure is shown as a short recovery state with **Try again** and
**Contact support**, never as a server error body. The root recovery boundary
also protects against a rendering failure. It is not an error-reporting system;
issue #161 owns production telemetry.

## Triage

1. Record the time, affected surface (API, sign-in, reminders, content refill, or
   mobile delivery), and the exact `main` commit used by the protected Supabase
   deployment. Do not copy secrets or raw request bodies.
2. Check `GET /functions/v1/api/health` on the production Supabase project.
   Inspect Edge Function logs and the protected deploy run for the incident
   window; a healthy response does not prove authenticated routes work.
3. In Supabase, check project health and authentication status. Do not alter
   data, RLS policies, or migrations during diagnosis unless the incident plan
   specifically requires it.
4. Check `cron.job`, `edge_worker_jobs`, and recent `edge_worker_runs` for the
   affected scheduled job. A healthy API does not prove reminders or content
   generation ran successfully. Check the corresponding application queue and
   delivery result before retrying work.
5. Check GitHub Actions only for the relevant commit: migrations, release
   validation, and EAS publication are release controls, not proof that a live
   dependency is healthy.

## Communication and recovery

- Tell learners what is affected, what they can safely keep doing offline, and
  when the next update will be posted. Do not expose incident IDs, stack traces,
  database/provider names, or security details publicly.
- Prefer a rollback to the last known healthy Edge Function revision when a
  newly deployed API or worker revision is the confirmed cause. Verify API
  `/health`, a signed-in read, and the relevant scheduled jobs afterward.
- If Supabase is unavailable, do not attempt ad-hoc restores. Pause destructive
  operator actions, use the documented provider recovery process, and validate
  identities, data access, and RLS before reopening normal traffic.
- If a mobile configuration is incorrect, ship a corrected build or update;
  do not advise users to change app internals. The configuration screen directs
  them to support.

## Release and follow-up

Before publishing a release, follow [RELEASING.md](../RELEASING.md): verify the
same `main` commit is healthy on the API and workers, complete any manual
migration procedure, then publish the mobile release. An OTA update cannot
repair a native runtime mismatch; that needs the native release procedure.

After recovery, create a concise incident record with the impact window,
confirmed cause, mitigation, verification performed, and follow-up owner. Keep
credentials and raw diagnostics in the approved private operational system.
