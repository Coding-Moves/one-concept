# Owner dashboard

The owner section lives in the existing `admin/` website alongside the reviewer
workspace. It adds four read-only reports: **Overview**, **Reviewers**,
**Operations**, and **Events**. There is no second authentication database,
public leaderboard, new paid provider, infrastructure console, or browser access
to application tables. This implements #297; deployment of both sections belongs
to #281 after the normal `develop` → `main` release.

## Access and privacy

Every `/v1/editorial/owner/*` request requires the existing editorial feature
switch, a verified JWT, a live Auth session, active editorial membership, an
approved registered name, MFA (`aal2`), and **`manage_reviewers`**. This existing
administrative capability now grants reporting as well as account management.
The ordinary `review` capability is insufficient. Grant `manage_reviewers` only
to the owner or explicitly trusted administrators through the existing audited
account workflow. Hiding the navigation is not the authorization boundary.

Responses are `Cache-Control: no-store` and vary by authorization. Reports live
only in component memory; sign-out, account changes and access denial discard
privileged state and ignore late responses. There is no persistent report cache.
Existing workspace membership/session checks still run on focus and every minute.
Report values themselves refresh on navigation, filter changes or **Refresh
reports**, without automatic polling. A failed refresh labels retained values as
an old snapshot; a failed first load never invents zero counts. After two minutes,
the observation timestamp asks for a refresh.

Only aggregate learner data is returned. No learner emails, individual learning
histories, lesson bodies, private review notes, request payloads or exception text
are included. Reviewer names come from authenticated editorial evidence.

## Metric definitions

All learning/report date filters use UTC, with an inclusive end date (today is
partial) and at most 90 days. The default is 30 days. These reporting rules do not
change assignment, streak, reminder or generation timezone rules.

| Report | Definition |
| --- | --- |
| Registered learners | Existing profiles created before the selected end. Accounts with editorial membership but no completed learning by then are excluded. |
| New learners | Those learner profiles created within the selected range. |
| Active learners | Distinct learners completing a concept or daily review in the 1, 7 or 30 UTC calendar days ending at the selected end date. A sign-in alone is not activity. |
| Lessons completed | Canonical `user_concept_completions` records using actual completion time. Retry/idempotent writes do not create another concept completion. |
| Reviews completed | Completed `daily_reviews` records using completion time, independently of their assignment date. |
| Daily chart | Lessons, reviews and distinct active learners per UTC day, with zero-filled days. The expandable table provides the same values accessibly. |
| Membership/workload | Current snapshot, independently of the historical report range. Open revisions exclude stale base versions and archived concepts. |
| Approval events | Immutable `approved` and legacy `attested` events in the period. |
| Unique concepts approved | Distinct concepts per reviewer in those approval events. Multiple versions can produce several events but one concept. |
| Unique concepts published | Distinct concepts published during the period, credited to the recorded approval author. Approval may precede the period. |
| Rejections/changes requested | Distinct immutable decision events in the period, not the current revision status. |

Deleted learner profiles and their cascading learning records are excluded from
historical reports too: these are aggregates of retained records, not immutable
historical census snapshots. Test accounts in the connected database are included
because there is no trusted test-account flag. Do not compare an unfiltered
Supabase Auth count directly with registered learners.

Reviewer names use the latest immutable signature before the range end, falling
back to the current approved name or “Name pending.” Renaming/revocation does not
rewrite signatures. Deleted reviewers remain visible when their approval or
publication evidence occurs in the period. Adding per-reviewer unique counts is
not a team-wide unique count when several people reviewed the same concept.

## Operational signals and limits

API/database “reachable” means this authorized reporting request succeeded; it
is not historical uptime. If the API or database is unavailable the UI shows a
report error. Generation/email switches, reserved daily generation calls, AI job
states and email-batch states come from the existing backend. Generation budgets
retain the existing `America/Los_Angeles` day. A reservation can include a failed
attempt and is not a billing total. Email “Accepted” means the provider accepted
it; it does not prove inbox delivery.

Optional `OWNER_TELEMETRY_ENABLED` defaults to **false**. When enabled on API,
reminders and pool-topup, the existing processes record only allowlisted status
codes, UTC timestamp, service, severity and a random correlation UUID in
`owner_operation_events`. API failure correlation matches its public incident ID
(UUID formatting may differ). Worker start and terminal events share an ID.
Telemetry never includes credentials, stack traces, raw errors or user input.
It uses a separate short transaction, 750 ms statement timeout and a one-second
write deadline; a logging failure does not replace the worker's result.

- Worker observations are unavailable when disabled or absent. Starts without a
  terminal observation become stale after 30 minutes. Terminal observations are
  stale after 45 minutes for the 15-minute reminders cron and 36 hours for the
  daily pool-topup cron. If schedules change, adjust these thresholds in code.
- “Completed” describes process completion, not generation, publication or email
  success. Individual skipped/failed work remains in the existing job/outbox
  counters and provider consoles.
- The event feed combines safe projections of operation, review, workflow and
  account events. Filter by source, severity, literal status-code text, UUID and
  date; cursor pages are limited to 50 rows (UI uses 25). Audit correlation IDs
  identify their individual immutable event, not an invented distributed trace.
- Operation events are capped at 10,000 rows using serialized pruning/insertion.
  Records older than 30 days are hidden from reporting and physically removed
  on the next telemetry write. If all telemetry is disabled, old rows can remain
  stored until that next write. Immutable editorial evidence is never pruned.
- Reporting statements have a five-second database timeout; query windows are
  bounded and additive indexes cover activity time, evidence time/actor and
  operation lookup. Total registered accounts still requires a retained-profile
  aggregate. Large deployments may need measured query tuning/materialization.
- Host CPU/memory, provider inbox logs, historical uptime and request latency
  are explicitly unavailable. Use the host/provider consoles for them.

Static hosting and the existing database/API/workers are sufficient. This adds
no paid monitoring subscription, but still consumes their existing CPU, storage,
request and free-tier quotas. It is not unlimited free infrastructure.

## Local synthetic preview

Use Node 24 and the normal admin dependencies:

```sh
cd admin
npm ci
npm run dev
```

Open `http://127.0.0.1:5173/?demo=owner` (or the port Vite prints). Demo selection
happens **before** public configuration validation and before constructing an
Auth or API client. No credentials are required for the development preview.
The fixed demo date, names, events and metrics are fictional. Changing filters
uses the in-memory adapter. No production network request, sign-in or mutation
path exists in demo mode, even if the browser has a previous Auth session.

A production build still validates the normal four public settings. Demo does
not bypass access checks for the real workspace. The real route is `/?view=owner`
after authorized sign-in; demo is `/?demo=owner`.

## Manual activation — deferred to #281

No manual action is needed to open or merge this implementation PR into
`develop`. It neither applies SQL nor deploys/activates either website section.
When #281 performs the rollout after the production release:

1. Follow the existing migration procedure, applying ordered migrations through
   [`0039_owner_reporting.sql`](../backend/migrations/0039_owner_reporting.sql)
   after 0038. Verify the actual schema contract. Update `applied.txt` only after
   verified production application; CI does not count as production evidence.
2. Deploy the compatible API and both existing workers. Keep existing generation
   and email switches unchanged. Reporting does not need generation/email enabled.
3. Build/host the existing `admin/` application using the four public variables
   in [admin/README.md](../admin/README.md), HTTPS, SPA fallback and the private
   response/security headers. Configure exact CORS/Auth redirects there. Both
   dashboard sections share this application and origin; separate services are
   unnecessary.
4. Confirm the intended owner account has an approved name, MFA and
   `manage_reviewers`. An ordinary reviewer must be denied all four report URLs.
5. Optionally enable `OWNER_TELEMETRY_ENABLED=true` on the API, reminders and
   pool-topup services once the migration is verified. Wait for ordinary scheduled
   runs; do not run content generation just to paint a green status. Until then,
   worker observations correctly remain unavailable.
6. Reconcile a controlled learner completion and a known review/publication with
   the reports. Verify sign-out, revocation, unavailable states, narrow layout,
   keyboard use and both themes on the deployed origin. Verify actual host headers
   and email/provider behavior separately; mock browser tests do not prove them.

To roll back the dashboard, deploy the previous frontend and disable telemetry.
Retain the additive table/indexes and immutable evidence; do not delete existing
editorial records. This implementation requires no mobile release or native change.
