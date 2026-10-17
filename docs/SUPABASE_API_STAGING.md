# Supabase API candidate staging (#416)

The current candidate implements all 73 inventoried JSON paths under
`/functions/v1/api`. [The route matrix](SUPABASE_API_ROUTE_PARITY.md) records
each consumer and validation state. Local route coverage is complete; hosted
learner, avatar, and load checks passed, while role and privacy acceptance
still needs verification.
Keep Railway and all production clients on the existing API until #416 meets
its acceptance criteria and #418 performs the cutover.

The first staging schema run applied migrations 0001–0049 and deployed the
candidate at commit `b8fddd4`. Protected run `38726466061` then applied and
verified migrations 0050–0053, and run `38726754703` deployed their history/saved,
subtopic, daily-selection, and completion routes at commit `5afbc04`. Live
`/health` returned 200 and unauthenticated `/v1/topics` returned 401. Protected
SQL run `38735682216` then applied and verified migrations 0054–0056, and
Edge run `38736653739` deployed commit `6fd67d2`. Live `/health` again
returned 200 with a reachable database and anonymous `/v1/topics` returned
401. A protected
incremental job checks the exact staging project, the verified 0049 RPC,
and explicit before/after RPC signatures for each later migration. The
fresh-project runner must not be rerun against the initialized project.
Protected SQL run `38739632606` applied and verified migrations 0057–0059 in
staging. Edge run `38740221408` deployed commit `e0cf046` to that project;
live `/health` returned 200 with a reachable database and anonymous
`/v1/topics` returned 401. Protected 0060–0064 SQL runs `38745247414` and `38746546997` both stopped
before applying migration 0060: their signature guard rejected, respectively,
a reviewed zero-argument RPC and an older `timestamp with time zone` RPC.
Commit `375ca68` replaces the syntax check with an exact list of reviewed
signatures and tests every entry. Protected SQL run `38748163954` then applied
and verified migrations 0060–0065, and Edge run `38748701535` deployed their
candidate routes at commit `4cabca5`. Live `/health` returned 200 with a
reachable database and anonymous `/v1/topics` returned 401. Protected SQL run
`38754177200` applied and verified migrations 0066–0070 in staging; Edge run
`38754683827` deployed their matching candidate. Live `/health` returned 200 with
a reachable database and anonymous `/v1/topics` returned 401. Migrations
0071–0085 and their directed relationship, quiz, and initial editorial routes
were later applied in protected SQL runs, with a matching Edge deployment.
Authenticated smoke `39013630407` passed learner state, topics, stats, and
achievements. Protected SQL run `39017139079` applied and verified migrations
0086–0093 only in staging; matching Edge deployment `39017303094` succeeded.
Its authenticated learner smoke `39017399735` passed. Protected SQL run
`39018239902` applied and verified migrations 0094–0096 in staging; matching
Edge deployment `39018413405` succeeded on the same commit. Authenticated
learner smoke `39018579596` passed. Protected SQL run `39025372409` applied
and verified migrations 0106–0109; matching Edge deployment `39025589698`
succeeded at commit `111a560`. Protected SQL run `39028009783` applied and
verified migrations 0110–0116. The matching Edge deployment `39028248776`
succeeded at commit `a5ae057`. Hosted learner and avatar smoke `39028385181`
passed at that commit. The 500-request load probe `39028577679` passed at
commit `8b0567b`. Editorial role/MFA and privacy checks remain pending, so
production clients stay on Railway.
Protected SQL run `39034607694` applied and verified migration 0117 in staging.
It grants only the three service-only editorial RPCs that read `auth.users`
the trusted owner context needed for reviewer invitations and last-owner
checks. A disposable PostgreSQL regression test exercises the invitation as
`service_role`. The Edge function code was unchanged by this SQL repair.

## Local checks

- Use Node 24 and the existing locked mobile TypeScript installation:
  `mobile/node_modules/.bin/tsc -p supabase/functions/tsconfig.json` and
  `node --experimental-strip-types supabase/functions/api/handler.test.mjs`.
- From `backend/`, run `.venv/bin/python -m pytest tests/test_edge_api_basics.py tests/test_edge_api_concepts.py tests/test_edge_api_notifications.py tests/test_edge_api_stats.py tests/test_edge_api_collections.py tests/test_edge_api_subtopics.py tests/test_edge_api_daily.py tests/test_edge_api_completion.py tests/test_edge_api_achievements.py tests/test_edge_api_reviews.py tests/test_edge_api_state.py tests/test_edge_api_followed_topics.py tests/test_edge_api_profile_update.py tests/test_edge_api_analytics.py tests/test_edge_api_profile_sharing.py tests/test_edge_api_public_profile.py tests/test_edge_api_connection_preferences.py tests/test_edge_api_connections.py tests/test_edge_api_connection_status.py tests/test_edge_api_connection_request.py tests/test_edge_api_connection_block_token.py tests/test_edge_api_connection_action.py tests/test_edge_api_connection_unblock.py tests/test_edge_api_relationship_status.py tests/test_edge_api_relationship_connect.py tests/test_edge_api_relationship_remove.py tests/test_edge_api_relationship_block.py tests/test_edge_api_relationship_list.py tests/test_edge_api_weekly_quiz.py tests/test_edge_api_subtopic_quiz.py tests/test_edge_api_editorial_me.py tests/test_staging_migrations.py -q -rs`
  against the disposable PostgreSQL 16 fixture. A skip is not a pass.
- Run `backend/tests/test_staging_api_smoke.py` with the local suite. The
  protected smoke job signs in with a dedicated staging Auth user and compares
  the startup, topic, statistics, and achievement responses. The latest smoke
  also uploads a tiny PNG to private Storage, reads its short-lived JPEG link,
  and removes it. It never logs account credentials, access tokens, or signed
  URLs. Its startup request may create that test user's daily assignment.
- For runtime parity, serve the function with the Supabase CLI and an isolated
  local stack when available. TypeScript/Node tests do not prove Deno runtime
  packaging or hosted behavior.

## Staging load evidence

The protected `supabase-api-staging-load-*` job runs
`backend/tools/staging_api_load.py` only against project
`zhrulokgngjceqgjkcmw`. It signs in with the dedicated test account, warms its
daily assignment, then sends 500 authenticated `GET /v1/me/state?compact=true`
requests through 10 workers. It records p50/p95 request latency, median and
maximum response bytes, and baseline, sampled peak, and end counts from
`pg_stat_activity`. The guard validates both the HTTPS project reference and
the port-5432 PostgreSQL connection before making requests. The job fails on
non-200 responses, oversize replies, or database sample failure, and prints no
tokens, URLs, passwords, or response bodies.

This is a 500-request burst by **one** test identity, not a simulation of 500
independent user profiles or a Free-tier capacity guarantee. For planning,
500 daily users making one state call each imply about 15,000 state calls in
30 days; four API calls each imply about 60,000 calls. Record the measured
burst result and inspect the Supabase project's Function Invocations,
Function Compute, database size, and connection usage in its dashboard before
the #418 production switch. Add other app, public profile, and editorial
traffic to that estimate; the protected probe measures only the state route.

On 2026-10-17, [protected run 39028577679](https://github.com/Coding-Moves/one-concept/actions/runs/39028577679)
completed 500 state reads through 10 workers in 43.0 seconds with no HTTP
failure. Request latency was p50 853 ms and p95 1,198 ms; median and maximum
responses were both 1,516 bytes. `pg_stat_activity` showed 11 database
connections before the burst, a sampled peak of 30, and 24 immediately after.
The runner was in Azure westus2 and the Supabase project is in ap-northeast-1,
so these timings include long-distance network latency and should not be used
as mobile-device latency predictions. [Supabase's current Edge pricing](https://supabase.com/docs/guides/functions/pricing)
lists 500,000 monthly invocations on Free. The simple 60,000-call projection
would be 12% of that quota before all other traffic; check the dashboard's
actual usage and the current plan limits during #418.

## Protected role workflow

Create two additional confirmed Auth users in staging: one dedicated owner and
one dedicated reviewer. Keep each email and password only in the protected
`supabase-staging` environment secrets
`SUPABASE_STAGING_OWNER_EMAIL`/`SUPABASE_STAGING_OWNER_PASSWORD` and
`SUPABASE_STAGING_REVIEWER_EMAIL`/`SUPABASE_STAGING_REVIEWER_PASSWORD`.
Set the staging Edge runtime secret `EDITORIAL_ENABLED=true` before the
`supabase-api-staging-roles-*` run. The script refuses the production and any
unreviewed project before it signs in or writes SQL. It first checks the
editorial endpoint is enabled, then bootstraps only the dedicated owner with
an account event. Through the candidate API, that owner invites the existing
reviewer, the reviewer requests a display name, and the owner approves it.
The probe checks that MFA blocks an unverified reviewer, records a staging-only
MFA policy change with an account event, then checks the reviewer queue, owner
overview, and role isolation. The dedicated learner must remain unable to
enter editorial routes. It also enables the owner's public profile with every
private field unselected, verifies the anonymous allowlist, disables sharing,
and verifies the old link returns 404. The direct MFA policy change is test
setup; production authenticator changes must continue through the verified
user flow.

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
   RPCs. It verifies the new RPCs after SQL and asks PostgREST to reload its
   schema cache. A retry skips an already complete migration. Add explicit
   probes and tests when adding each later migration. If previously installed
   RPCs work in SQL but return errors over HTTP, a separate protected
   `supabase-api-staging-reload-*` tag runs only the PostgREST cache notification
   against this exact staging project; it does not apply migrations or deploy
   the Edge function. Rerun the authenticated smoke afterward.
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
   Keep `EDITORIAL_ENABLED` false until staging has dedicated confirmed owner
   and reviewer accounts with current Auth sessions and membership rows. Set
   it to `true` only for protected role/MFA acceptance checks; the handler
   still verifies each bearer token and the SQL gate checks the current session.
   To test reviewer invitations, set `EDITORIAL_INVITE_REDIRECT_URL` to the
   exact approved site callback URL. Its HTTPS origin must also appear in
   `ALLOWED_ORIGINS` and in the staging Auth redirect allowlist. A local HTTP
   callback is accepted only outside production. New invitations fail closed
   until this callback is configured; existing Auth users can be enrolled
   without sending another invitation.
   For owner notification reporting, mirror the existing server-only
   `EDITORIAL_EMAIL_ENABLED`, `EDITORIAL_EMAIL_DASHBOARD_URL`,
   `EDITORIAL_EMAIL_DAILY_CAP`, `EDITORIAL_EMAIL_FROM`, Gmail client ID/secret/
   refresh token, and `EDITORIAL_EMAIL_TEST_RECIPIENTS` settings. The API passes
   only a derived setup status and daily cap into the SQL overview; the Gmail
   credentials remain in Edge secrets. Keep email disabled in staging until
   the scheduled delivery worker in #417 has been verified there.
   The owner operations readout also uses server-only `ENVIRONMENT`,
   `OWNER_TELEMETRY_ENABLED`, `EDITORIAL_AUTO_CORRECTION_ENABLED`, and
   `GENERATION_DAILY_CALL_CAP`; mirror any current FastAPI overrides before
   comparing owner reports. It returns only aggregates and recent worker status.
   In staging Storage, create a private bucket named `profile-avatars` if it
   does not exist. Set its file limit to 256 KiB and allow `image/jpeg`.
   The API accepts JPEG/PNG/WebP input but stores only normalized JPEG. Keep
   the dedicated smoke user's avatar empty before its upload/removal test.
   The candidate bundles a pinned 15 MB ImageMagick WASM file via
   `supabase/config.toml`; the deploy job must use the CLI's Docker builder,
   not `--use-api`. A successful TypeScript build alone does not validate
   the hosted WASM file path or CPU use. To stay inside the hosted
   [256 MB memory and 2-second CPU limits](https://supabase.com/docs/guides/functions/limits),
   JPEG input uses a decoder downsample hint and retains the 25 MP ceiling;
   PNG/WebP input now returns 422 above 8 MP. This is a deliberate difference
   from FastAPI's 25 MP cap for all formats. Step #418 must keep the mobile
   error message and photo selection compatible with that format limit.
   On the local Node/WASM probe, a 25 MP JPEG used about 149 MB peak RSS and
   0.6 seconds, while 8 MP PNG/WebP used about 209/192 MB and 1.6/1.4
   seconds. Those are process measurements on the development host, not proof
   of Supabase's hosted CPU or memory use; the staging upload validates the
   hosted path with a small PNG.
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
   projects. A successful smoke covers the listed learner reads and avatar
   upload/read/removal, not the remaining role, privacy, and load checks.
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
