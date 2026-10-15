# Supabase API candidate staging (#416)

The current candidate serves health, topics, concept detail, idempotent
Like/Save, notification preferences, push-token, streak-statistics, history,
saved-pagination, subtopic-progress, daily-selection, completion, review,
achievement, startup-state, followed-topic, profile-edit, analytics, and private
profile-sharing settings, filtered public-profile, connection-preference,
and connection-list routes at
`/functions/v1/api`. The remaining entries in
[the route matrix](SUPABASE_API_ROUTE_PARITY.md) are not implemented. Keep Railway
and all production clients on the existing API until #416 meets its acceptance
criteria and #418 performs the cutover.

The first staging schema run applied migrations 0001–0049 and deployed the
candidate at commit `b8fddd4`. Protected run `38726466061` then applied and
verified migrations 0050–0053, and run `38726754703` deployed their history/saved,
subtopic, daily-selection, and completion routes at commit `5afbc04`. Live
`/health` returned 200 and unauthenticated `/v1/topics` returned 401. Protected
SQL run `38735682216` then applied and verified migrations 0054–0056, and
Edge run `38736653739` deployed commit `6fd67d2`. Live `/health` again
returned 200 with a reachable database and anonymous `/v1/topics` returned
401. An authenticated staging learner flow has not yet been checked. A protected
incremental job checks the exact staging project, the verified 0049 RPC,
and explicit before/after RPC signatures for each later migration. The
fresh-project runner must not be rerun against the initialized project.
Protected SQL run `38739632606` applied and verified migrations 0057–0059 in
staging. Edge run `38740221408` deployed commit `e0cf046` to that project;
live `/health` returned 200 with a reachable database and anonymous
`/v1/topics` returned 401. Migrations 0060–0063 and their private/public
profile-sharing and connection routes are locally tested but not yet staged. The authenticated
smoke still needs its staging test account and GitHub environment secrets.

## Local checks

- Use Node 24 and the existing locked mobile TypeScript installation:
  `mobile/node_modules/.bin/tsc -p supabase/functions/tsconfig.json` and
  `node --experimental-strip-types supabase/functions/api/handler.test.mjs`.
- From `backend/`, run `.venv/bin/python -m pytest tests/test_edge_api_basics.py tests/test_edge_api_concepts.py tests/test_edge_api_notifications.py tests/test_edge_api_stats.py tests/test_edge_api_collections.py tests/test_edge_api_subtopics.py tests/test_edge_api_daily.py tests/test_edge_api_completion.py tests/test_edge_api_achievements.py tests/test_edge_api_reviews.py tests/test_edge_api_state.py tests/test_edge_api_followed_topics.py tests/test_edge_api_profile_update.py tests/test_edge_api_analytics.py tests/test_edge_api_profile_sharing.py tests/test_edge_api_public_profile.py tests/test_edge_api_connection_preferences.py tests/test_edge_api_connections.py tests/test_staging_migrations.py -q -rs`
  against the disposable PostgreSQL 16 fixture. A skip is not a pass.
- Run `backend/tests/test_staging_api_smoke.py` with the local suite. The
  protected smoke job signs in with a dedicated staging Auth user and compares
  the startup, topic, statistics, and achievement responses; it never logs the
  account credentials or access token. Its startup request may create that
  test user's daily assignment.
- For runtime parity, serve the function with the Supabase CLI and an isolated
  local stack when available. TypeScript/Node tests do not prove Deno runtime
  packaging or hosted behavior.

## Isolated deployment prerequisites

1. Use a staging Supabase project or a test project with no production traffic.
   Do not run this candidate against live learner/reviewer accounts while most
   routes are absent. Verify the exact project reference before each command.
2. Apply the repository's ordered migrations to that project through
   `0049_supabase_stats_api.sql` using its port-5432 session-pooler PostgreSQL
   URL. The protected schema tag in step 4 runs
   `backend/tools/apply_staging_migrations.py` after validating the target.
   For a local fallback, run the script with `--check-only`, then without it,
   with `STAGING_PROJECT_REF`, `PRODUCTION_PROJECT_REF`, and
   `STAGING_DIRECT_URL` set privately in the shell. The runner requires the
   connection to identify the staging project, refuses a production match,
   and only applies the full sequence to a fresh Supabase project. Do not
   paste the URL into chat or store it in a repository file. These
   migrations are intentionally absent from `backend/migrations/applied.txt`;
   only a verified production application belongs there. Check that only
   `service_role` can execute the `edge_api_*` RPCs.
   If the schema job rejects the project as nonfresh, stop. Push a unique
   `supabase-api-staging-inspect-*` tag on a reviewed commit and approve its
   protected job. It reads only schema metadata and whether `profiles` has
   any rows; it does not print user records. Use that evidence to plan a verified
   incremental path or a fresh staging project; do not drop tables or retry
   the full migration sequence blindly.
   For the current project `zhrulokgngjceqgjkcmw`, the owner authorized
   removing its disposable demo schema and Auth users. A separate protected
   `supabase-api-staging-reset-*` tag runs `--reset-demo`: it requires that
   exact project reference, no custom Auth user triggers, empty Storage objects
   and buckets, and precisely the inspected six public tables plus
   `rls_auto_enable()` and its `ensure_rls` event trigger. One transaction drops
   those objects with `RESTRICT` and deletes the Auth users; an inventory
   mismatch, stored object, or other dependency stops it without committing.
   Review the tag commit,
   approve the reset job, verify the fresh-project check, and only then run
   the separate schema tag for migrations 0001–0049.
   For this initialized staging project, inspect the commit containing the
   new migration, then push a unique `supabase-api-staging-incremental-*` tag.
   Its protected job runs `--apply-incremental`; it refuses an unknown project,
   a missing 0049 baseline, an unlisted later migration, or partially present
   RPCs. It verifies the new RPCs after SQL. A retry skips an already complete
   migration. Add explicit probes and tests when adding each later migration.
   Approve that job separately before deploying an updated Edge candidate.
3. In the staging project, set `ALLOWED_ORIGINS` to exact HTTPS website origins
   needed for browser testing. No wildcard is accepted. `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are Edge runtime secrets;
   never copy the service key to a client, PR, log or build artifact.
   If the current FastAPI deployment overrides its supply defaults, set
   `CONTENT_LOW_WATERMARK`, `CONTENT_RESERVE_PER_TOPIC`, and
   `CONTENT_ACTIVE_DAYS` to the same bounded integers in the Edge environment;
   otherwise they default to 10, 60, and 90. The daily RPC receives these
   values explicitly and never receives a client-supplied date.
4. Configure the protected GitHub `supabase-staging` environment with a scoped
   `SUPABASE_STAGING_ACCESS_TOKEN` secret granting Edge Functions write on the
   staging project, a `SUPABASE_STAGING_DATABASE_URL` secret containing only
   that project's session-pooler URI on port 5432, plus
   `SUPABASE_STAGING_PROJECT_REF` and `SUPABASE_PRODUCTION_PROJECT_REF`
   variables. Insert the staging database password into the URI, encoding
   reserved URL characters. The staging environment requires approval by
   `Muawiya-contact` and accepts only `supabase-api-staging-*` tags. After
   reviewing the exact commit and passing PR checks, create and push a unique
   `supabase-api-staging-schema-*` tag for a fresh project, or an
   `supabase-api-staging-incremental-*` tag for this initialized project. Approve
   its protected job and verify the applicable SQL and RPC checks succeed.
   Then create and push a
   unique `supabase-api-staging-deploy-*` tag on the same commit; approve its
   separate protected job. The first job receives the database URI, and the
   second receives the scoped Edge token. The deploy job refuses an absent or
   identical project target and deploys only `api`. GitHub cannot dispatch a
   new workflow manually from a PR branch before the workflow reaches the
   default branch.
   For the separate authenticated smoke tag, create a dedicated user only in
   the staging project's Authentication → Users area. Save that user's email
   and password as `SUPABASE_STAGING_TEST_EMAIL` and
   `SUPABASE_STAGING_TEST_PASSWORD` in the same GitHub environment. Save the
   staging project's publishable API key as
   `SUPABASE_STAGING_PUBLISHABLE_KEY` there. Never put these values in the
   repository or chat. After the SQL and Edge deployment jobs succeed, push a
   unique `supabase-api-staging-smoke-*` tag on the same commit and approve its
   protected job. Its project-reference guard rejects production and other
   projects. A successful smoke covers only the listed learner reads, not the
   remaining route, role, privacy, and load checks.
   `supabase/config.toml` disables
   gateway JWT verification because health is public; the handler verifies a
   bearer token through Supabase Auth before any private RPC. A route added
   later must explicitly choose its public/private policy.

The initial staging probe must get `{ "status": "ok", "database": "reachable" }`
from `/functions/v1/api/health`, `401` from `/functions/v1/api/v1/topics` without
a bearer token, and the expected topic array with a valid **staging** account.
Check concept detail, repeated Like/Save writes, and unknown slug `404` against
the same seeded data. Exercise notification preferences, an optional weekly
quiz setting, push-token registration, bodyless deregistration, and timezone-
aware streak statistics on a test
account. An unapproved Origin must receive `403`. Compare these
responses to the existing FastAPI endpoints. Never paste token values or full
request headers into CI logs.

## Promotion gate

This file is a candidate procedure, not a deployment record. Before a production
switch, every route in the matrix needs contract and security coverage,
authenticator/reviewer flows need live staging verification, avatar operations
need image and private Storage tests, and 500 daily-user load/usage estimates
need measured evidence. #418 owns old-client compatibility and rollback.
