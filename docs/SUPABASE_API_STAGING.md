# Supabase API candidate staging (#416)

The current candidate serves health, topics, concept detail, idempotent
Like/Save, notification preferences, push-token, and streak-statistics routes at
`/functions/v1/api`. The remaining entries in
[the route matrix](SUPABASE_API_ROUTE_PARITY.md) are not implemented. Keep Railway
and all production clients on the existing API until #416 meets its acceptance
criteria and #418 performs the cutover.

## Local checks

- Use Node 24 and the existing locked mobile TypeScript installation:
  `mobile/node_modules/.bin/tsc -p supabase/functions/tsconfig.json` and
  `node --experimental-strip-types supabase/functions/api/handler.test.mjs`.
- From `backend/`, run `.venv/bin/python -m pytest tests/test_edge_api_basics.py tests/test_edge_api_concepts.py tests/test_edge_api_notifications.py tests/test_edge_api_stats.py -q -rs`
  against the disposable PostgreSQL 16 fixture. A skip is not a pass.
- For runtime parity, serve the function with the Supabase CLI and an isolated
  local stack when available. TypeScript/Node tests do not prove Deno runtime
  packaging or hosted behavior.

## Isolated deployment prerequisites

1. Use a staging Supabase project or a test project with no production traffic.
   Do not run this candidate against live learner/reviewer accounts while most
   routes are absent. Verify the exact project reference before each command.
2. Apply the repository's ordered migrations to that project through
   `0049_supabase_stats_api.sql` using its port-5432 direct or session-pooler
   PostgreSQL URL. From this branch, run
   `python backend/tools/apply_staging_migrations.py --check-only`, then
   `python backend/tools/apply_staging_migrations.py` with
   `STAGING_PROJECT_REF`, `PRODUCTION_PROJECT_REF`, and `STAGING_DIRECT_URL`
   set privately in the shell. The runner requires the connection to identify
   the staging project, refuses a production match, and only applies the full
   sequence to a fresh Supabase project. Do not paste the URL into chat or
   store it in a repository file. These
   migrations are intentionally absent from `backend/migrations/applied.txt`;
   only a verified production application belongs there. Check that only
   `service_role` can execute the `edge_api_*` RPCs.
3. In the staging project, set `ALLOWED_ORIGINS` to exact HTTPS website origins
   needed for browser testing. No wildcard is accepted. `SUPABASE_URL`,
   `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are Edge runtime secrets;
   never copy the service key to a client, PR, log or build artifact.
4. Configure the protected GitHub `supabase-staging` environment with a scoped
   `SUPABASE_STAGING_ACCESS_TOKEN` secret granting Edge Functions write on the
   staging project, plus `SUPABASE_STAGING_PROJECT_REF` and
   `SUPABASE_PRODUCTION_PROJECT_REF` variables. The staging environment requires
   approval by `Muawiya-contact` and accepts only `supabase-api-staging-*` tags.
   After reviewing the exact commit and applying the staging SQL migrations,
   create and push a unique tag of that form on the candidate commit. The
   tag-triggered `supabase-api-candidate.yml` workflow refuses an absent or
   identical target and deploys only `api`. GitHub cannot dispatch a new
   workflow manually from a PR branch before the workflow reaches the default
   branch. SQL migrations are a separate, verified prerequisite.
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
