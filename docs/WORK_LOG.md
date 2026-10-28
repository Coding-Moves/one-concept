# Work log

Keep durable working agreements in [../AGENTS.md](../AGENTS.md) and the source
navigation guide in [CODEBASE_MAP.md](CODEBASE_MAP.md). This file records current
work and handoffs. Do not store credentials, raw private data, or speculative
claims as completed work.

## Current status

### Production auth landing hotfix review — PR #460, 2026-10-28

- Scope: review the `main` hotfix for Supabase Edge confirmation, recovery, and privacy pages; keep the existing production Netlify redirects working. PR [#460](https://github.com/Coding-Moves/one-concept/pull/460) remains open for independent review and the protected production deployment.
- `9dfd2eb` makes a direct `/confirmed` visit neutral instead of falsely reporting verified email, matching the correction on `develop`. `32fd36f` adds script-level recovery edge cases and Chromium tests for direct confirmation, a successful recovery update, and an expired link.
- `922e77e` replaces the retired-host redirect runbook with the current `main` mobile redirect and Edge fallback sequence, and maps the Edge page source. Local validation: 97 Edge handler tests, Supabase function TypeScript check, 17 admin unit tests, admin build with CI fixture variables, and all 53 Chromium tests passed. Hosted PR checks and a real inbox recovery test remain to be verified after push; no migration is involved.

### Supabase production release/cutover — issue #418, 2026-10-21

- Scope: prepare one reviewed Step 3 branch from merged `develop` at `caaf0be`, retaining production on Railway until browser, deploy, OTA, Cron and retirement gates are observed. The owner asked for one large PR; issue #418 and `RELEASING.md` specify a `develop` → `main` release PR, so the PR target and gate exception must be explicit before merge. Production SQL was applied under the protected gate described below; Edge deployment, Cron and EAS remain unchanged. On October 21, the owner disabled Railway Auto Deploy on `api`, `reminders`, and `pool-topup` while leaving the current services and schedules running; the pasted `api` settings explicitly show it disabled.
- `51f7596` decouples mobile Auth and public profile browser links from the API URL using a validated web origin, while accepting an optional legacy web origin for old QR links. Mobile typecheck and 98 unit tests passed.
- `8d7c277` hosts confirmation, recovery, privacy and public-profile HTML on the static reviewer site; it validates the Supabase function API URL and keeps only publishable config in the browser. Admin typecheck, 17 unit tests, build, and all 50 browser tests passed.
- `b035cc6` adds a main-only, protected Supabase production deploy with project guards, read-only schema checks and API health; Release now requires its successful run ID for the same SHA. `de99858` publishes preview before a second protected production OTA approval and rejects a reused tag before any OTA. These workflows are not yet run in production.
- During self-review, `b56f43c` forced the four Netlify public rewrites ahead of directory routing. `e5e6807` makes the mobile release validator and reviewer build reject an API function URL from a different Supabase Auth project; the focused mobile config tests (3/3), mobile typecheck, admin tests (17/17) and admin typecheck passed. The full admin browser suite (50/50) passed before those two small config/rewrite follow-ups.
- [Release PR #434](https://github.com/Coding-Moves/one-concept/pull/434) targets `main` from the one Step 3 branch per owner request. It contains the already-reviewed Step 1/2 commits from `develop`; the smaller Step 3-only comparison is linked in the PR because the full PR diff exceeds GitHub's 20,000-line API limit. It was marked ready for code review after all required hosted checks passed on `f52597a`; GitHub still requires an independent review. Netlify canceled its deploy preview by site policy, so the new public pages need live hosting validation after merge.
- Read-only GitHub inspection found `production-schema` had only a `main` branch rule. Using the owner's `Muawiya-contact` identity, the same environment was updated to require owner review while preserving its `main` branch rule and existing secret. On October 21 the owner saved `SUPABASE_PRODUCTION_ACCESS_TOKEN`; GitHub confirms the exact secret name and update time, while its effective scope has not yet been exercised. The production Supabase Edge Secrets page initially showed no custom secrets. The owner later supplied a names-only screenshot showing nine safe configuration secrets saved. Each displayed SHA-256 prefix matched the intended nonsecret value without revealing the stored value. After that screenshot the owner reported saving `WORKER_DATABASE_URL` from the existing production session-pooler connection string, saving a fresh `WORKER_DISPATCH_SIGNING_KEY` in Edge Secrets and production Vault, and saving the production worker URL in Vault. These private values still need a protected boot and signed-dispatch check; no production Edge deployment has been dispatched. `07d826e` fixed an inline privacy-page stylesheet that the generated CSP would block.
- The owner approved exact tag `supabase-production-schema-cutover-fe098ffa231df8a4fc177b88b3e6a0b91d6133da` in protected [run 39596754671](https://github.com/Coding-Moves/one-concept/actions/runs/39596754671). Its target and 0045 baseline guards passed; all 85 migrations 0046–0130 applied; the first live `schema_check` returned ready. The final verifier initially failed before connecting because its workflow used a file path instead of the Python module (`ModuleNotFoundError: app`). `b958a90` fixed both invocations and `1a9e702` added an exact-tag read-only verifier. The owner approved [run 39598031891](https://github.com/Coding-Moves/one-concept/actions/runs/39598031891): its SQL apply job was skipped, its production connection guard passed, and both independent schema checks reported ready. The verified filenames are now recorded in `backend/migrations/applied.txt`; do not rerun the SQL job.
- The owner took a private production database archive at 2026-10-21T11:43:58Z. Its SHA-256 checksum and archive format passed. An isolated, network-disabled local Supabase PostgreSQL 17 database accepted a full restore with `pg_restore --exit-on-error`; aggregate checks confirmed public tables and RLS, Auth records, and Storage metadata. The temporary database was removed. This verifies database recovery, not external Storage file objects or Supabase service settings. The archive and restore record remain private and Git-ignored.
- The exact 0046–0130 range was replayed in filename order against a second fresh, network-disabled restore of that production archive. All 85 SQL files completed with `ON_ERROR_STOP`; read-back found 101 `edge_api_*` functions, 31 `edge_worker_*` functions, `edge_api_health()` and the worker ledger. The disposable rehearsal database was removed. This is a compatibility rehearsal, not production application.
- The production environment has both reviewed project-reference variables, the backup reference, the required owner reviewer, the retained `main` branch rule, and a single-SHA allowlist for the SQL run. Supabase's documentation confirms Free projects need a manual CLI dump; the runbook was updated with that caveat. A final browser-route audit found About → Privacy still used the API host; `648a161` moves it to the static web origin, with mobile typecheck passing. The PR was still draft at that point; no production Edge deployment or client switch has run.
- `docs/SUPABASE_CUTOVER.md` records the ordered preflight, backup, migration, browser, EAS, job handover, observation and retirement gates. The production ledger now records 0001–0130 after the successful production SQL run and independent read-back. The owner reported production Supabase Free-plan usage for 25 Sep–25 Oct: database 0.033 GB (31.94 MB), Storage 0 GB, egress 0.099 GB, 5 MAU, and 1 Edge invocation. This is a pre-cutover snapshot, not a 500-user capacity test. At 500 daily users and 30 API calls each, 30-day API traffic would use 450,000 of 500,000 included Edge invocations before workers or retries. Full Railway SHAs, connection utilization, EAS values, OAuth rotation, static-site publication and old-client tail remain operational evidence to collect.
- A release-gate review found the Netlify site cancels PR deploy previews, while the new browser routes exist only on this branch. The cutover checklist now keeps Netlify's Railway API setting through the `main` static-page deploy, verifies those pages, and changes Netlify to the Supabase API only after the function is deployed and checked. Railway stays on its current deployment while mobile clients are tested.
- A read-only check of the current published Netlify HTML and JavaScript on October 21 found the production Supabase Auth hostname and the Railway API hostname, as intended before merge. No credential values were printed; Netlify's private build settings and publishable key have not been independently checked.
- The production deployment now checks the worker's own unsigned-dispatch 401 response after deployment, catching a missing or malformed signing key before the workflow can report success. The exact read-only probe passed against the deployed staging worker; it starts no job and calls no provider.
- Hosted backend, mobile, reviewer/browser, release-guard, and migration checks all passed on Step 3 PR head `800ff37`. These checks do not exercise the one-time installer against live pg_cron; its existing-job guard is based on Supabase Cron's documented overwrite behavior and remains to be observed during production installation. The screenshot-confirmed production Edge secret inventory is recorded in the cutover runbook; no secret values were shared. Production functions, inactive Cron installation, and phone/OTA rollout remain pending.
- Final Cron review found that `cron.schedule` overwrites a job with the same name. The one-time inactive installer now refuses to run when any `one-concept-` job already exists, avoiding accidental deactivation after handover. No production Cron installation has run.
- Hosted backend, mobile, reviewer/browser, release-guard and migration checks all passed on documentation head `2d58af6`. The production worker and API remain undeployed; private Netlify build settings, provider flags/key, inactive Cron, phone canary, and the eventual Railway handover remain to be verified.
- The owner subsequently reported copying the production Railway Gemini key directly to production Supabase Edge Secrets and saving `EDITORIAL_ENABLED=true`, `GENERATION_ENABLED=true`, and `LEGACY_ENRICHMENT_ENABLED=true`. `EDITORIAL_EMAIL_ENABLED=false` and its daily cap remain zero. These settings have not been exercised by deployed production Edge code. Commit `4331fde` adds a protected current-main Cron installer that runs the reviewed one-time SQL only after validating the production connection and worker schema, then reads back the exact eight inactive job names; it remains unrun until merge and owner approval. Focused installer and production-target tests passed locally (8/8), and the workflow YAML parsed successfully. No production function, Cron job, or client has switched.
- The owner confirmed Netlify's saved API URL still points to Railway, the Auth URL names the production Supabase project, and a publishable key is present. A separate read-only production database query reported 16 of 60 connections open (1 active), all five tracked work queues at zero, and no `cron.job` schema. It returned only aggregate counts and printed no credential. Hosted backend, mobile, reviewer/browser, workflow validation, and migration checks passed on `4fcecd7`; Netlify canceled its deploy preview by site policy. These observations do not establish 500-user capacity or exercise the new production Edge functions.
- Capacity review: 500 daily users making 30 API calls each for 30 days imply 450,000 Edge invocations. If the jobs are enabled, the planned per-minute reminder schedule adds 43,200; editorial-generation and legacy-enrichment schedules add 21,600 each. That 536,400-call scenario exceeds the documented 500,000 Free allowance before retries, so running those enabled schedules at that traffic level requires a higher allowance or materially fewer API calls.
- A repeat code review of PR #434 found three release gates that could accept the wrong state: production OTA could still use Railway's API URL; the inactive Cron installer did not require a successful deploy of the same `main` SHA; and the deploy/release schema checks did not validate that their database URL identified the production project. Focused commits `052b5cb`, `7a1a27c`, and `d7f8873` close those gaps without switching any live traffic. The production URL guard's two Node tests, nine existing release-revision tests, eight production target/Cron Python unit tests, workflow YAML parsing, and `git diff --check` passed locally. `pytest` was unavailable in this checkout, so those Python tests ran through `unittest`; hosted checks on the new head remain to be observed. The runbook now sequences the Netlify live-page check after merge because PR previews are canceled. Railway remains live, production Edge/Cron/OTA remain unstarted, and the PR still requires independent review and a separate owner merge confirmation.

### Supabase scheduled worker migration — issue #417, 2026-10-18

- Branch `codex/supabase-cron-workers` starts from `develop` at `69b01c5`. Scope is one feature PR for all Railway scheduled/background work, with production Supabase schedules disabled until the step-3 cutover. The owner confirmed Railway production runs `reminders` every 15 minutes and `pool-topup` at 22:00 UTC; source is `main`. On October 20, the owner showed three green recent runs of each service: reminders sent zero tokens and processed zero editorial emails, while pool-topup reported generation disabled and empty revision/enrichment work. Both deployment panels identify release PR #414, whose merge commit is `c244088aa285127a3f065cc1d7e41afdae8bf36f`; Railway's full deployed SHA and some effective non-secret flags remain to be checked. The owner later showed `reminders` with `GEMINI_MODEL=gemini-3.1-flash-lite` and `GENERATION_DAILY_CALL_CAP=200`.
- Intended focused changes: document the live workload map; add a restricted Cron dispatch and run ledger; port push/email and content queues as bounded Edge work; test overlap, retries and interruption; run controlled staging canaries; add release version and What's New; review the full PR before marking it ready. Do not infer successful worker runs from successful Railway deployments.
- Commits `ed2187f`, `07b8ac2`, `7681520`, `c95ef86`, `b77ee69`, and `f7c049a` document the Railway baseline, add a default-disabled run ledger, signed Edge entry point, HTTP result reconciliation, and a bounded daily reminder outbox/Expo task. A signed queue item contains no service key; an HTTP 200 does not imply worker completion.
- [Draft PR #431](https://github.com/Coding-Moves/one-concept/pull/431) targets `develop` and references #417 without closing it. `6bf314e` commits the inactive Cron installer and handover guide; `d0e1c79` adds worker tests to hosted PR checks. The branch merged dependency-only updates from current `develop` in `be05a84` without rewriting its focused commits.
- The draft now includes weekly quiz, reviewer email, curated refill, editorial revision, legacy enrichment, demand-triggered prefetch, eight inactive Cron schedules, a protected staging batch, and a read-only operator report. Version `1.10.15` and its matching What's New card are prepared with native runtime `1.10.8` unchanged. The release metadata and staging setup are included in focused later commits through `f623f04`.
- Validation at `06e5e26`: GitHub backend, mobile and review-web checks all passed; local focused PostgreSQL concurrency checks, worker Node tests, TypeScript and lint also passed. On October 20 the owner saved a staging-project-scoped access token with Edge Function Secrets permissions. Protected [staging batch attempt 2](https://github.com/Coding-Moves/one-concept/actions/runs/39411782016/attempts/2) passed: migrations 0119–0127, staging-only worker deployment, eight inactive Cron jobs, and one signed provider-disabled dispatch. The owner's Railway Cron screenshots show recent green no-op runs; `reminders` has `EDITORIAL_EMAIL_ENABLED=true` while `WEEKLY_QUIZ_NOTIFICATIONS_ENABLED` is absent and therefore defaults to false. `pool-topup` has `GENERATION_ENABLED=true` and `LEGACY_ENRICHMENT_ENABLED=true`; its refill pass reported generation disabled, but that does not establish the separate `FUTURE_REFILL_ENABLED` setting. Full Railway deployment SHAs, remaining safe effective flags/caps, live provider canaries and a final review remain outstanding. Production Supabase schedules are off and no production setting changed.
- Protected [provider batch](https://github.com/Coding-Moves/one-concept/actions/runs/39419310982) on `1d7dae4` accepted one daily and one weekly Expo push and staged one private AI revision; the owner confirmed phone delivery. Its reviewer email was not sent. `29bdb4c` added a read-only, redacted diagnostic; [its protected run](https://github.com/Coding-Moves/one-concept/actions/runs/39420059105) found one Gmail attempt failed with `sender_authorization`, before Gmail granted an access token. Both runs closed every staging worker gate and removed temporary Edge provider secrets. `72f69f6` adds an email-only retry path guarded to that exact unsent batch, with no repeat phone/AI calls; its hosted checks and a fresh owner-managed Gmail refresh token are pending. Production schedules and Railway services remain unchanged.
- The owner refreshed the staging Gmail token and approved the [email-only retry](https://github.com/Coding-Moves/one-concept/actions/runs/39425758027); it failed again with `sender_authorization` before sending, and cleanup passed. `46ec400` added a no-send OAuth token-exchange probe. Protected [diagnostic 39426828505](https://github.com/Coding-Moves/one-concept/actions/runs/39426828505) returned Google's `invalid_client`: the staged OAuth client credentials were rejected. The owner is replacing the staging client ID and secret with the exact Google Cloud client used for the refreshed token; values stay out of chat and Git.
- Final review found the owner dashboard would keep reading Railway's old worker observations after cutover. `9a91f70` adds immutable migration 0128 to switch owner worker status and event metadata to the Edge run ledger when any new worker is enabled; inactive staging still shows Railway observations. Four focused PostgreSQL/schema checks passed, and 22 staging migration checks passed with two skips. `233e412` makes the final email-only retry preflight OAuth before writes, apply reviewed staging migrations in the same protected run, and allow a third attempt only for the same unsent batch with two authorization failures. Thirty focused unit tests passed with two skips; hosted checks and the final staged email/inbox check remain. Production Supabase schedules stay off.
- Final review also found unbounded growth in `edge_worker_runs`. Migration 0129 prunes at most 1,000 terminal rows older than 30 days per HTTP reconciliation while retaining queued/running and recent runs. Its focused ledger and schema tests passed 5/5 on disposable PostgreSQL 16; staging application, hosted checks, and the Gmail canary remain pending.
- The owner updated the staging Gmail client ID and secret, but protected retry [39432423321](https://github.com/Coding-Moves/one-concept/actions/runs/39432423321) still returned Google's `invalid_client` during the no-send preflight. It applied no SQL and sent no email; the gate and temporary-secret cleanup passed. After the owner replaced the Web OAuth client pair and refresh token, independent protected staging batch [39433077026](https://github.com/Coding-Moves/one-concept/actions/runs/39433077026) verified migrations 0128–0129 present, redeployed the candidate worker, installed eight inactive Cron schedules and passed a signed provider-disabled dispatch. The [grouped retry 39434233939](https://github.com/Coding-Moves/one-concept/actions/runs/39434233939) again returned `invalid_client` before sending; cleanup passed. All three hosted PR quality jobs pass on the current branch. PR #431 remains draft until the controlled Gmail inbox canary and final inventory/review pass.
- On October 21, protected [OAuth check 39464589607](https://github.com/Coding-Moves/one-concept/actions/runs/39464589607) returned `token_exchange_ok` after the staging client ID was corrected. The guarded [email retry 39542771867](https://github.com/Coding-Moves/one-concept/actions/runs/39542771867) recorded one batch `sent` on attempt 3 and one worker result with `sent=1`; gate and temporary-secret cleanup passed. The workflow nevertheless failed because its canary treated `succeeded` with a still-pending HTTP receipt as terminal. Commit `4c7abcb` waits for the separate pg_net receipt, with 13 focused canary/retry/smoke tests passing. At that point inbox delivery and the final transport status were unverified, so the already-sent batch was not retried.
- The owner subsequently found that one controlled email in the reviewer mailbox's Spam folder. Protected read-only [diagnostic 39543659155](https://github.com/Coding-Moves/one-concept/actions/runs/39543659155) reported one sent batch and `sent=1` but `http=0`: the separate pg_net receipt was not yet copied into the ledger. Commit `9ba416b` adds a guarded, staging-only reconciliation of that existing receipt without dispatching or resending; 16 focused tests and all three hosted PR quality jobs passed. Protected [run 39545446007](https://github.com/Coding-Moves/one-concept/actions/runs/39545446007) then recorded HTTP 200, one sent batch, and no pending or failed batches. The Spam placement remains a production deliverability consideration; production schedules stay off.
- Final review found that an uncertain Gmail send result or an expired `sending` lease could be retried automatically and produce a duplicate. Commits `9ff9ef9` and `e76c79e` mark such outcomes `failed/delivery_unknown` for human review; pre-send OAuth failures remain retryable. Focused Edge tests passed, as did three disposable PostgreSQL/schema tests for migration 0130. The owner approved the [combined staging SQL/deploy/signed-smoke run](https://github.com/Coding-Moves/one-concept/actions/runs/39546867510): migration 0130, worker deployment and eight inactive schedules passed, but the signed smoke reported a generic failure. A read-only status diagnostic in `18777c0` is [waiting at GitHub's protected gate](https://github.com/Coding-Moves/one-concept/actions/runs/39547577482). Railway inspection also confirmed `pool-topup` has `FUTURE_REFILL_ENABLED=false` and `LEGACY_ENRICHMENT_BATCH_SIZE=25`. No production settings changed.
- Protected [diagnostic 39547577482](https://github.com/Coding-Moves/one-concept/actions/runs/39547577482) narrowed the first final smoke failure to HTTP 503. Commit `a99039b` added fixed, non-sensitive smoke failure labels; ten focused tests passed. The owner approved [staging rerun 39548604015](https://github.com/Coding-Moves/one-concept/actions/runs/39548604015), which succeeded: all 130 ordered migrations through 0130 were present, the candidate worker deployed, eight Cron schedules were verified inactive, and a signed provider-disabled dispatch completed. Backend, mobile, and review-web hosted quality jobs all passed on `a99039b`. Push, private AI draft, Gmail inbox receipt and HTTP reconciliation had already passed their controlled staging checks. The remaining Railway full deployed SHA and pool-topup cap/pace must be verified before step-3 activation; keep those provider gates off until then. Production remains on Railway with Supabase schedules disabled.
- Acceptance audit after marking #431 ready found an unfinished #417 requirement: the live Railway inventory still lacks both full deployed SHAs, some effective switches/caps (especially pool-topup generation cap and pace), direct pending-queue counts, and confirmation of any extra one-off worker command. Green no-op cron logs cannot prove those facts. The PR was restored to draft and `Closes #417` removed; all three hosted quality jobs and staging checks remain green. Complete this inventory and recheck the manual paths before marking the PR ready again. No production changes were made.
- The owner pointed back to earlier Railway variable answers and supplied PR #414's GitHub merge page. GitHub confirms `c244088aa285127a3f065cc1d7e41afdae8bf36f` is that release's merge commit, matching both Railway deployment card titles; do not ask for the same SHA again. The owner had already supplied `GENERATION_ENABLED=true`, `LEGACY_ENRICHMENT_ENABLED=true`, `FUTURE_REFILL_ENABLED=false`, legacy batch size 25, `EDITORIAL_EMAIL_ENABLED=true`, reminders call cap 200 and shared Gemini model `gemini-3.1-flash-lite`; the weekly flag is absent and defaults false. Release code defaults generation cap 200 and pace 6.0 seconds if no pool override exists. Values masked in the earlier captures, current production queue counts, and any pool cap/pace overrides remain the narrow #417 inventory gap. Direct Railway SHA and out-of-band command confirmation can be rechecked during step-3 cutover. PR #431 remains draft; no production changes occurred.
- On October 21 the owner supplied the two previously masked Railway shared values: `EDITORIAL_EMAIL_DAILY_CAP=0` and `CONTENT_REVIEW_BACKLOG_LIMIT=30`. The zero cap blocks production editorial email despite its enabled switch. Commit `551e6fa` changed the candidate worker fallback from 40 to zero; the runbook requires an explicit zero cap and closed email gate at cutover. The owner ran the five-count aggregate in production Supabase SQL Editor and showed zero pending/generating editorial jobs, zero pending/sending email batches, zero unbatched unsuppressed email entries, zero pending/retry/sending weekly pushes, and zero pending/generating curated backlog. This is a snapshot only. Source entry points for the documented manual CLIs and both Railway cron commands were checked. Pool-topup generation cap/pace overrides were not visible to the owner, so step 3 must confirm their absence before enabling a paid provider job; the direct deployed SHA and any out-of-band CLI practice are also cutover checks. All 12 Node worker test files passed, `git diff --check` passed, and local TypeScript compilation was unavailable because dependencies are not installed; hosted PR CI will run it. No Railway or production Supabase setting changed.
- Release-copy review found version `1.10.15` advertised weekly quiz nudges and automatic topic refill even though those production switches are off. Commit `a953d12` narrows the nonempty What's New entry to daily reminder delivery, the supported step-2 path; `runtimeVersion` remains unchanged. Version/card text and `git diff --check` were inspected. Final hosted checks on the new PR head are pending.
- Final [PR quality run 39555122992](https://github.com/Coding-Moves/one-concept/actions/runs/39555122992) passed backend lint/tests, mobile typecheck/tests including Supabase functions, and review website build/browser tests on `2a0daf4`. PR #431 was updated with the production cap and five zero queue counts, changed to `Closes #417`, and marked ready for review. It is mergeable and remains unmerged. Production still runs on Railway; all new production Cron schedules remain off. The exact Railway SHA, generation cap/pace overrides, current queue counts, and any out-of-band CLI practice must be rechecked before step-3 activation.
- An independent pass over #431's signed dispatch, SQL claim fencing, provider retries, run ledger, owner status, and cutover guide found one daily Expo accounting gap: an `ok` ticket without an ID was recorded as accepted. Commit `4648f14` now records that malformed response as unknown and fails the worker run; the regression test keeps valid-ticket canaries passing. All 12 Node worker test files passed locally, and [PR quality run 39557486502](https://github.com/Coding-Moves/one-concept/actions/runs/39557486502) passed backend, mobile/Supabase TypeScript, and browser jobs. The staging provider canary predates this malformed-ticket guard; no new provider send is needed to prove the conservative fallback. PR #431 remains open and ready, with production still on Railway and Supabase Cron inactive. Step 3 must recheck live Railway overrides, queues, credentials, and deployed SHA before enabling jobs.

### Coding Moves site catalog — 2026-10-20

- **Outcome:** identify One Concept as a Coding Moves Product and link its README to the Products section.
- **Scope:** documentation only, based on current `origin/develop`; no application or release changes.
- **Validation:** review the README link and run `git diff --check`. Application tests are outside this documentation change.
- **Handoff:** [PR #433](https://github.com/Coding-Moves/one-concept/pull/433) targets `develop`; commit `4f6d12f` adds the README link and this scoped log entry. The Products page is updated in a separate website PR. No application tests were run for this documentation-only change.

### Supabase API migration candidate — issue #416, 2026-10-15

- Protected role/privacy run [39034796873](https://github.com/Coding-Moves/one-concept/actions/runs/39034796873) passed owner invitation, reviewer onboarding, MFA denial, role isolation, queue, and public-profile field/link privacy with three distinct staging test accounts. Final review found the Edge candidate lacked the existing 120-read/60-write authenticated request budget. Commits `c00794a`, `cf18a16`, and `c4b7022` add a service-only shared PostgreSQL token bucket, enforce its 429/`Retry-After` contract in Edge, and adapt the 500-request probe to count expected throttling. Disposable PostgreSQL/schema/runner tests: 48 passed; a later 500-call concurrent SQL regression passed; Edge handlers: 92 passed; TypeScript passed; load-script unit tests: 4 passed. Protected SQL run `39079447842` applied migration 0118. The first load runs exposed intermittent `edge_api_state` five-second timeouts; `0a1caea` extends only that read RPC to eight seconds and protected Edge run `39081462372` deployed it. The strict final load run `39081564483` passed 500 single-account requests with five workers: 450 HTTP 200, 50 valid HTTP 429, no 503, p50 1,329 ms, p95 4,195 ms, 1,404-byte responses, and database connections 19/21/20 before/peak/after. This is not a 500-distinct-user capacity claim. All three PR quality jobs passed on `8923918`; #419 was marked ready with `Closes #416`, while production remains on Railway.
- A second code review found that valid 4,000-character Unicode audit notes exceeded the Edge handler's default 4 KiB JSON body limit on editorial commands. `55d8c27` gives those commands the existing 64 KiB editorial bound while keeping learner writes at 4 KiB; the new long-note and oversize-body regression passed with all 93 Edge handler tests. Hosted CI for this review fix is pending; no staging redeployment has occurred.
- Outcome: build the first of three Railway-exit PRs on `codex/supabase-api-migration` from current `develop`, without changing production clients or Railway services.
- Chunk boundary: inventory every HTTP route, establish a secure Supabase Edge Function/SQL request path, then port and verify API contracts in focused commits. Scheduled workers belong to #417; browser/client cutover and release belong to #418.
- Intended commits: route and consumer inventory; Edge authentication/routing foundation with tests; atomic SQL and endpoint ports with contract tests; deployment/verification guidance; final review and handoff. Keep this PR draft until #416 acceptance is met.
- Progress: `a503f63` maps 73 OpenAPI paths and four public HTML paths; `509b302` adds service-role-only health/topics SQL RPCs and real-PostgreSQL checks; `9eef340` adds a manually authenticated Edge candidate for those two routes with eight handler regressions; `53554bd` adds staging-only manual deployment guidance/guard and CI checks. No production client or Railway service changed.
- Validation: Edge TypeScript typecheck and eight Node handler tests passed. Two SQL tests passed on disposable PostgreSQL 16 with Podman; Ruff `F,E9` and `git diff --check` passed. No Supabase CLI/Deno packaging run or live staging deployment has occurred.
- Remaining: 65 OpenAPI paths, browser HTML in #418, full role/MFA/avatar/daily/owner parity, staging deployment, security and load checks, and production cutover remain. Keep the first PR draft and avoid an issue-closing keyword until its acceptance items pass. Migrations 0046–0049 are not marked production-applied.
- [Draft PR #419](https://github.com/Coding-Moves/one-concept/pull/419) targets `develop` and references #416 without closing it. Self-review found and fixed the first candidate's auth/outage response and credentialed CORS mismatch in `75c4bc1`; Edge typecheck and all eight handler tests passed again. Hosted validation remains pending.
- `910bb89` adds service-only concept detail and idempotent interaction RPCs; `152cbc6` exposes their Edge routes. Five focused PostgreSQL tests, eleven handler tests, Edge typecheck, Ruff `F,E9`, and diff whitespace checks passed. The owner supplied a staging project ref distinct from the local client project; the `supabase-staging` GitHub environment and staging ref variable are configured. A scoped deploy token, production ref guard value, migration application and hosted test remain pending.
- `57d8a86` adds service-only notification and device-token RPCs; `4baf307` ports their Edge routes. The focused PostgreSQL suite passed eight tests, Node passed fourteen handler tests, Edge typecheck, Ruff `F,E9`, and diff whitespace checks passed. A Node strip-only TypeScript syntax issue was fixed before committing. Staging schema application and live route verification remain pending.
- `d336d2c` adds a service-only streak RPC matching the Python calculation from the profile timezone; `3d94400` exposes the authenticated route. The focused PostgreSQL suite passed ten tests, Node passed fifteen handler tests, Edge typecheck, Ruff `F,E9`, and diff whitespace checks passed. The staging deploy secret and production-ref guard remain absent, so no deployment was attempted.
- Self-review found that GitHub `workflow_dispatch` cannot start a workflow present only on a PR branch. Changed the candidate deploy to an explicit staging-tag trigger, restricted the `supabase-staging` environment to matching tags, and required `Muawiya-contact` approval. No tag or deployment has been created. The staging PAT and production project ref are still needed.
- Added a guarded staging migration runner for fresh projects: it verifies the named staging ref from a port-5432 Supabase connection, rejects the production ref, and stops if application tables already exist. Seven local guard tests, a dry-run file inventory, and Ruff `F,E9` passed. No staging SQL was applied; a private staging database URL and production ref are still required.
- The owner supplied the production project ref and saved a staging-project-scoped Edge Functions token in GitHub. Both distinct project-ref variables and the secret name are verified in the protected `supabase-staging` environment; the secret value is not readable. Hosted backend CI exposed an out-of-date reviewed schema contract. `10d4a4d` regenerates it from all 49 migrations and guards the eight Edge RPC definitions; `93e4cb0` fixes a separate cutover test fixture that recreated a cluster-wide role. One complete local backend run had 616 passes and that single cutover failure; its correction and the schema checks then passed all 34 focused tests with disposable PostgreSQL 16. Hosted checks on these new commits, staging SQL, Deno packaging, and deployment remain pending.
- All three hosted PR quality jobs passed on `96a226f`. `a7dd083` adds a separate protected schema-tag job using a staging-only database URI secret before the Edge deploy tag; its YAML parsed, seven staging guard tests passed, and whitespace checks passed. The staging database URI secret is still needed from the owner. Neither schema nor function has been deployed.
- The owner saved the staging database URI secret and approved the protected schema run on `88b778b`. The URL/project guard and PostgreSQL connection succeeded, but the runner rejected the target as nonfresh before applying any SQL; the deploy job was skipped. `f6d9fb1` adds a separate protected, read-only inspection mode and tag to identify existing schema objects before deciding how to install migrations. All eight staging guard tests, Ruff `F,E9`, YAML parsing, and whitespace checks passed locally; hosted inspection and any SQL application remain pending.
- Protected inspection run `38702065582` succeeded: `auth.users` and `public.profiles` exist, while topics, assignments, editorial membership, profile sharing, and candidate RPCs are absent. No SQL was applied. `744372f` extends read-only inspection to public object names, profile structure/dependencies, and a boolean row-presence check. Eight unit tests and one catalog query test on disposable PostgreSQL 16 passed; Ruff `F,E9` and whitespace checks passed. A second protected inspection is needed before deciding whether the conflicting table can be safely replaced.
- Protected inspection run `38704059875` found a separate demo schema in staging: `admins`, `payout_requests`, `profiles`, `screenshots`, `tasks`, `wallets`, and `rls_auto_enable()`. `profiles` has no rows but is referenced by the other demo tables. The owner explicitly authorized removing these demo objects. `a44e1f7` adds a one-project reset path requiring exact project reference, exact object inventory, no Auth users or custom Auth triggers, and a single transaction with `RESTRICT` drops; the fresh-project gate also rejects other public objects or preexisting Auth users. Twelve guard/unit tests passed; the reset/rollback and migration-0001 integration test passed on disposable PostgreSQL 16. Ruff `F,E9`, workflow YAML parsing, and whitespace checks passed. Protected reset, full staging migrations, and Edge deploy remain pending.
- All three hosted checks passed on `37e698b`. The owner approved protected reset run `38706202297`, which refused to run because Auth users exist in the staging project. Its SQL transaction did not commit; none of the demo objects was deleted, and no One Concept migration was applied.
- The owner then explicitly authorized deleting all Auth users and demo data in this staging project. `1b681ed` deletes Auth users in the same transaction as the exact-inventory demo-schema drops, refuses nonempty Storage, and verifies the fresh-project gate after committing. Twelve guard tests passed; one catalog test was skipped without Podman in the sandbox; the reset/rollback and migration-0001 integration test passed on disposable PostgreSQL 16 with Podman. Ruff `F,E9` and whitespace checks passed. A new protected reset run, schema application, and Edge deployment remain pending.
- All three hosted checks passed on `278c45b`. Protected reset run `38708366158` stopped because event trigger `ensure_rls` depends on the demo function `rls_auto_enable()`; the transaction rolled back and deleted no tables or Auth users. `cf0cb29` now requires that exact trigger/function link and drops the trigger with `RESTRICT` in the same transaction. Twelve unit tests and the disposable PostgreSQL reset/rollback and migration-0001 test passed; Ruff `F,E9` and whitespace checks passed. A new protected reset run is required before staging migrations.
- All three hosted checks passed on `b8fddd4`. The owner approved protected reset run `38709893317`; its log confirms the guarded transaction removed the reviewed demo schema, event trigger, and staging Auth users, and the fresh-project check passed. The owner approved protected schema run `38711197870`; all 49 ordered migrations applied and the final API RPC check passed. A separate candidate Edge deploy tag `supabase-api-staging-deploy-b8fddd4` is waiting at the protected staging gate. Production remains unchanged.
- The owner asked to finish #416 and make PR #419 ready for merge. Acceptance still requires the 65 unported OpenAPI paths, role and privacy controls, avatar handling, end-to-end staging flows, and usage measurements. Continue with focused SQL/Edge endpoint commits and contract tests, then rerun staging checks and an independent PR review before marking it ready. The next implementation chunk is bounded learner history and saved pagination.
- Protected Edge deploy run `38719743338` succeeded on `b8fddd4`. A live staging probe returned `200` with `{"status":"ok","database":"reachable"}` for `/health`, while anonymous `/v1/topics` returned `401`; no authenticated staging test account exists after the authorized Auth reset. `6910649` adds service-only history/saved pagination RPCs and reviewed schema definitions; three PostgreSQL 16 contract tests passed. `df6f085` adds Edge routes, query guards, and two handler tests; all 17 handler tests and TypeScript typecheck passed. Migration 0050 and those routes are not yet in staging. An incremental staging migration path is needed before another hosted deployment.
- The latest `c5de377` PR head passed all three hosted quality jobs. `838cf08` adds a protected incremental staging tag and runner for the exact reviewed staging project: it requires the 0049 RPC, explicit signatures for each migration after 0049, rejects partial installs, and checks RPCs after SQL. The 0050 path and migrations were verified by 24 local tests against disposable PostgreSQL 16; Ruff, workflow YAML parsing, and diff checks passed. No incremental tag has been pushed, so 0050 and the updated Edge routes are still only local/PR code.
- All three hosted quality jobs passed on `3ed999b`. `064ddc5` adds service-only subtopic progress and acknowledgment RPCs, reviewed schema definitions, and a 0051 staging probe; 25 focused PostgreSQL 16 tests passed. `1bca14d` adds their Edge routes; all 19 handler tests and TypeScript typecheck passed. No incremental staging tag has run yet, so 0050–0051 and these newer routes are not live. Draft PR #419's description now reflects the actual staging state and remaining parity work.
- All three hosted quality jobs passed on `6fab02e`. `f120582` ports daily selection into one transaction with profile-timezone dates, exact unfinished-lesson carryover, followed-subject boundary, no repeat after learning, and a coalesced supply signal; `e9778d4` exposes `GET /v1/daily`. Thirty focused PostgreSQL tests passed, including two-device concurrency and timezone; the reviewed schema contract, Edge typecheck, 20 handler tests, Ruff, and whitespace checks passed. The full completion/state/review path remains unported. Migrations 0050–0052 and the new routes are not staged yet.
- Self-review found that the new daily RPC used PostgreSQL defaults when called through PostgREST, which could diverge from configured FastAPI supply thresholds. `729ea8e` passes bounded Edge environment values explicitly; TypeScript and all 20 handler tests passed again. The new thresholds default to the FastAPI values. Hosted checks on this follow-up remain pending.
- All three hosted jobs passed on `c8b4a33`. `2d9374b` adds idempotent daily completion, subtopic events, and award evaluation in service-only SQL with migration 0053 and staging probes; 27 focused PostgreSQL 16 tests and the reviewed schema contract passed. `6886437` exposes authenticated `POST /v1/daily/complete`; all 21 Edge handler tests and TypeScript typecheck passed. Fourteen of 73 OpenAPI paths are now candidate routes; 59 remain. Migrations 0050–0053 and their routes are not deployed to staging yet; production is unchanged.
- All three hosted jobs passed on `5afbc04`. With the owner's protected approvals, staging SQL run `38726466061` applied and verified migrations 0050–0053, then Edge run `38726754703` deployed that exact commit. Live staging `/health` returned 200 with a reachable database, and anonymous `/v1/topics` returned 401. Authenticated learner/editorial flows, route parity, usage measurements, and independent final review remain outstanding; production clients and Railway are unchanged.
- The owner confirmed #419 retains the full #416 API scope and stays draft until its acceptance checks pass. `f59fd3c` adds service-only achievement collection/acknowledgment SQL and the 0054 staging probe; 26 focused PostgreSQL 16 and schema-contract tests passed. `e5b9942` exposes the two account-scoped Edge routes; all 22 handler tests, TypeScript typecheck, Ruff `F,E9`, and diff checks passed. Candidate parity is 16 of 73 paths, with 57 remaining. Migration 0054 and these routes are not yet staged; the deployed staging candidate remains `5afbc04`.
- All three hosted jobs passed on `58a4bd1`. `bd9b405` adds transactional followed-topic review selection and idempotent completion SQL with account, grace-window, and concurrency tests; 27 focused PostgreSQL 16 tests and the reviewed schema contract passed. `578e74b` adds the review completion Edge route. `8e0eaf3` folds the server-dated daily assignment or review into compact/full startup state; its four PostgreSQL tests and schema contract passed. `2c353ab` exposes state through Edge with account-bound private-avatar signed URLs; all 25 handler tests, TypeScript, Ruff, and whitespace checks passed. Candidate parity is 18 of 73 paths, with 55 remaining. Migrations 0054–0056 and the new routes have not yet been staged; production remains on Railway.
- Hosted backend CI on `77ae5bb` found four review-test fixture failures: the fixture chose an arbitrary published concept that could be inactive after the complete suite's earlier fixtures. `dad321e` selects an active, followed concept and restores that same topic when testing the unfollowed boundary. The full backend suite then passed **666 tests** against disposable PostgreSQL 16. `bf8ea5d` adds a protected authenticated staging learner smoke job and guarded script; its tests were included in that full run, while Ruff `F,E9`, workflow YAML parsing, and diff checks passed. A dedicated staging Auth test user and three GitHub environment secrets are needed for the later smoke tag; no secrets belong in chat or the repository. PR #419 remains draft under the owner's full-API scope decision.
- All three hosted PR checks passed on `6fd67d2`. The owner approved SQL run `38735682216`, which applied and verified 0054–0056 only in staging, and Edge run `38736653739`, which deployed that commit only to staging. Live `/health` returned 200 with a reachable database; anonymous `/v1/topics` returned 401. `bdc15ee` adds migration 0057 for atomic followed-topic replacement and a profile snapshot that does not select a daily assignment; 29 focused PostgreSQL 16 tests and the schema-contract update passed. `12b2a43` exposes `PUT /v1/me/topics`; all 26 handler tests and TypeScript typecheck passed. Candidate parity is 19 of 73 paths, with 54 remaining. The 0057 code has not reached staging. Authenticated smoke remains pending the dedicated staging account and three environment secrets.
- All three hosted checks passed on `dc17439`. `fa027c4` adds migration 0058 for atomic profile edits, canonical timezone checks, explicit bio clearing, and preset-avatar reference handoff; 9 focused PostgreSQL tests and the schema-contract update passed. `759e478` exposes authenticated `PATCH /v1/me` with input validation, private old-avatar cleanup, and signed current-avatar URL; all 27 Node handler tests, TypeScript typecheck, Ruff, and whitespace checks passed. Candidate parity is 20 of 73 paths, with 53 remaining. Migrations 0057–0058 and their routes are not yet deployed to staging; production remains unchanged.
- All three hosted checks passed on `6cc5fa5`. `b680d04` adds migration 0059 for a 28-day profile-timezone activity window, summary totals, recent concepts/quizzes, and existing achievement/subtopic calculations; eight focused PostgreSQL 16 tests passed with its dependencies and the schema contract was updated. `a793da9` exposes account-scoped `GET /v1/me/analytics`; all 28 Node handler tests, TypeScript typecheck, Ruff, and whitespace checks passed. Candidate parity is 21 of 73 paths, with 52 remaining. Migrations 0057–0059 and their routes await staging; the dedicated Auth smoke account and environment secrets are still absent.
- All three hosted checks passed on `e0cf046`. With the owner's protected approval, staging SQL run `38739632606` applied and verified 0057–0059. The matching Edge run `38740221408` is waiting for separate protected approval. `4af0a92` adds migration 0060 for private, versioned sharing settings and token rotation on revocation; three PostgreSQL 16 tests and the schema contract passed. `6373e7d` exposes authenticated `GET/PUT /v1/me/profile-sharing`; all 29 Node handler tests, Edge TypeScript, Ruff `F,E9`, and whitespace checks passed. Candidate parity is 22 of 73 paths, with 51 remaining. Migration 0060 and its route have not reached staging. The dedicated Auth smoke account and its three environment secrets remain absent; production stays on Railway.
- The owner approved Edge run `38740221408`; GitHub deployed `api` at `e0cf046` to staging only. Live `/health` returned 200 with a reachable database and anonymous `/v1/topics` returned 401. All three hosted PR checks passed on `403548e`. Migration 0061 adds an allowlisted anonymous profile RPC with revocation, selected fields, earned achievements, and an owner-bound private avatar handoff; three PostgreSQL 16 tests and the reviewed schema contract passed. The Edge route filters fields again and signs only the owner-bound avatar; all 31 Node handler tests, TypeScript typecheck, Ruff, and whitespace checks passed. Candidate parity is 23 of 73 paths, with 50 remaining. Hosted checks on 0061 remain pending, and 0060–0061 have not reached staging.
- All three hosted PR checks passed on `c3c6e77`. Migration 0062 adds owner-scoped, optimistic-version connection invitation preferences; two PostgreSQL 16 tests and the refreshed schema contract passed. The matching authenticated Edge `GET/PUT` route passed all 32 Node handler tests, TypeScript typecheck, Ruff, and whitespace checks. Candidate parity is 24 of 73 paths, with 49 remaining. Hosted checks for this newest route and staging of 0060–0062 remain pending.
- All three hosted PR checks passed on `dfa8467`. Migration 0063 adds cursor-bounded connection pages with current public identity choices, block suppression, and no peer account IDs or emails; two PostgreSQL 16 tests and the schema contract passed. The authenticated Edge list route passed all 33 Node handler tests, TypeScript typecheck, Ruff, and whitespace checks. Candidate parity is 25 of 73 paths, with 48 remaining. Hosted checks for 0063 and protected staging of 0060–0063 remain pending; the three Auth-smoke secrets are still needed.
- All three hosted checks passed on `c2d72f0`. `25ffc74` and `5d2325a` add the private GET connection status RPC and verified Edge route; two PostgreSQL 16 tests, schema contract, and 34 Node handler tests passed. Protected SQL run `38745247414` stopped before migration 0060 because the signature guard rejected a reviewed zero-argument RPC. `b2d5a72` fixed that case, but protected run `38746546997` exposed the older `timestamp with time zone` signature in 0050 and also stopped before migration 0060. `375ca68` replaces the syntax check with an exact reviewed-signature allowlist; six focused guard tests and Ruff passed. No part of 0060–0064 is claimed staged yet.
- `c25bd52` adds a pair-serialized POST connection request RPC with current sharing/block checks, cooldown, idempotence, and request/pending limits; two PostgreSQL 16 tests and the updated schema contract passed. `908dfe5` exposes the authenticated method and retry headers; Edge typecheck and all 35 Node handler tests passed. This brings local candidate parity to 26 of 73 paths, with 47 remaining. Migration 0065 and the Edge method are not staged. The dedicated staging Auth user and three smoke secrets are still needed.
- All three hosted checks passed on `4cabca5`. With the owner's protected approvals, SQL run `38748163954` applied and verified migrations 0060–0065 and Edge run `38748701535` deployed the matching candidate to staging. Live `/health` returned 200 with a reachable database; anonymous `/v1/topics` returned 401. Migration 0066 adds token-based blocking that removes legacy and directed connections together; two PostgreSQL 16 tests passed. Its Edge route passed TypeScript and all 36 Node handler tests. Local candidate parity is 27 of 73 paths, with 46 remaining; 0066 is not staged. Authenticated learner smoke still needs the staging test user and three GitHub environment secrets.
- Migration 0067 adds pair-locked legacy connection actions with owner, role, stale-request, state-transition, and block checks; two disposable PostgreSQL 16 tests passed. Its Edge route validates the action body and connection ID, maps conflict/role errors, and passed TypeScript and all 37 Node handler tests. Local candidate parity is 28 of 73 paths, with 45 remaining. Migrations 0066–0067 and their routes have not been staged; the staging Auth smoke secrets are still absent.
- Migration 0068 adds owner-only idempotent legacy unblock; its PostgreSQL 16 test and the updated schema contract passed. The authenticated Edge DELETE route passed TypeScript and all 38 Node handler tests. Local candidate parity is 29 of 73 paths, with 44 remaining. Migrations 0066–0068 remain local pending hosted checks and protected staging; the three Auth smoke secrets are still absent.
- All three hosted PR checks passed on `6a21b6c`. Migration 0069 adds caller-scoped directed relationship status; its two PostgreSQL 16 tests passed. Migration 0070 adds idempotent directed connection creation with current visibility, blocking, and a serialized 24-hour limit; its two PostgreSQL tests passed. The reviewed schema contract and incremental signature test passed. The paired Edge GET/POST route passed TypeScript and all 40 handler tests. Local candidate parity is 30 of 73 paths, with 43 remaining. Migrations 0066–0070 have not been staged; authenticated smoke still requires the staging test user and three environment secrets.
- All three hosted PR checks passed on `7ffc6a7`. Protected SQL run `38754177200` applied and verified migrations 0066–0070 on staging; a duplicate waiting run for the same tag was canceled after the successful run. Matching Edge deployment is waiting at the separate protected gate. Migration 0071 adds owner-fenced, idempotent directed relationship removal; one disposable PostgreSQL 16 test, the schema contract, the staging signature check, TypeScript, and all 41 Edge handler tests passed locally. Local candidate parity is 31 of 73 paths, with 42 remaining. Migration 0071 is not staged. Only the staging test email secret is present; password and publishable key are still needed for authenticated smoke.
- Protected Edge run `38754683827` deployed commit `7ffc6a7` to staging. Live `/health` returned 200 with a reachable database; anonymous `/v1/topics` returned 401. All three Auth smoke secrets are now saved; protected run `38755787072` is waiting for approval. Migration 0072 adds owner-fenced block-by-relationship-ID that removes both directed choices and the legacy pair; its PostgreSQL test passed. Migration 0073 adds a private, cursor-bounded directed list with current sharing and block filtering; two PostgreSQL tests passed. Their Edge methods, including owner-bound avatar signing and a three-second list deadline, passed TypeScript and all 45 handler tests. Local candidate parity is 34 of 73 paths, with 39 remaining. Migrations 0071–0073 have not been staged.
- All three hosted checks passed on `72ec335`; unique staging SQL tag `supabase-api-staging-incremental-72ec335` created run `38770073264`, queued behind protected Auth smoke run `38755787072`. Migration 0074 freezes the ISO-week quiz with the same SHA-256 question index as FastAPI and hides answers; migration 0075 validates a full answer set, scores only the frozen snapshot, and appends immutable attempts. Their PostgreSQL tests, reviewed schema contract, incremental signature check, TypeScript, and all 47 Edge handler tests passed locally. Local candidate parity is 36 of 73 paths, with 37 remaining. Migrations 0071–0075 have not been staged; smoke approval is pending.
- All three hosted checks passed on `1fca07e`. Migrations 0076–0078 freeze owned subtopic quiz snapshots, score immutable attempts, and list at most 50 owned attempts. Their PostgreSQL tests, reviewed schema contract, incremental signature check, TypeScript, and all 50 Edge handler tests passed locally. Candidate parity is 39 of 73 paths, with 34 remaining. Protected Auth smoke run `38755787072` still waits for approval and holds queued staging SQL run `38770073264`; migrations 0071–0078 have not been staged.
- All three hosted checks passed on `35d08b2`. Migration 0079 adds the first editorial route, `/v1/editorial/me`: an Auth-verified bearer token supplies a session claim, while SQL independently checks confirmed Auth ownership, session expiry, bans, and active membership. Its PostgreSQL security test (including wrong session owner and banned user), schema/signature tests, TypeScript, and all 51 Edge handler tests passed locally. Candidate parity is 40 of 73 paths, with 33 remaining. The staging Auth smoke approval still holds the queued SQL tag; migrations 0071–0079 are not staged.
- Migration 0080 adds a common capability/name/MFA gate and a private, 100-row bounded editorial reviewer list. Its PostgreSQL role/pagination test, reviewed schema contract, incremental signature check, TypeScript, and all 52 Edge handler tests passed locally. The `/v1/editorial/reviewers` POST method is still pending, so complete-path parity remains 40 of 73 with 33 remaining. Migrations 0071–0080 are not staged; protected Auth smoke run `38755787072` still holds queued SQL run `38770073264`.
- `4741ec7` adds migration 0081 for a versioned editorial profile-name request with current-session checks before and after the account lock, plus an audit event. `890e657` exposes `PATCH /v1/editorial/me/profile` with strict input normalization. Five focused PostgreSQL/schema checks, TypeScript, 53 Edge handler tests, Ruff `F,E9`, and diff checks passed locally. Candidate parity is 41 of 73 paths; 32 remain. GitHub run `38755787072` still waits at its separate protected Auth smoke approval and holds queued SQL run `38770073264`; migrations 0071–0081 are not staged. Production remains unchanged.
- `cd8086e` adds migration 0082 for versioned reviewer notification timezones with server IANA validation and an audit event; `4ef05a6` exposes its authenticated PATCH route. Six focused PostgreSQL/schema checks, TypeScript, 54 Edge handler tests, Ruff `F,E9`, and diff checks passed locally. Candidate parity is 42 of 73 paths, with 31 remaining. Migrations 0071–0082 await protected staging; production remains unchanged.
- `c67b212` adds migration 0083 for versioned editorial authenticator choice, requiring a recent signed TOTP event to turn MFA off; `7e66f16` passes only the verified token's TOTP timestamp through Edge. Seven focused PostgreSQL/schema checks, TypeScript, 55 Edge handler tests, Ruff `F,E9`, and diff checks passed locally. Candidate parity is 43 of 73 paths, with 30 remaining. Migrations 0071–0083 await staging; production remains unchanged.
- `b4b6916` adds migration 0084 for owner-gated approval of another reviewer's exact requested name under the account lock; `7d0279d` exposes its versioned POST route. Eight focused PostgreSQL/schema checks, TypeScript, 56 Edge handler tests, Ruff `F,E9`, and diff checks passed locally. Candidate parity is 44 of 73 paths, with 29 remaining. Migrations 0071–0084 await staging; protected Auth smoke run `38755787072` still blocks the queued incremental SQL run. Production remains unchanged.
- On 2026-10-17, protected Auth smoke run `38755787072` failed with only a generic `HTTPError`, while protected SQL run `38770073264` applied and verified migrations 0071–0073 in staging. The later migrations and matching Edge routes are not deployed. The original local Git source checkout disappeared, so a clean clone of the existing PR branch was made in `/tmp/one-concept-smoke-fix` without altering the remote branch. The smoke script now reports only the fixed request step and HTTP status, never URLs, response bodies, or credentials; four focused tests passed without the database harness, Python compilation and `git diff --check` passed. A new protected smoke run will be required to identify the failing request before changing staging secrets or API code.
- All three hosted quality checks passed on `93b0597`; staging `/health` returned 200 and anonymous `/v1/topics` returned 401. Protected smoke tag `supabase-api-staging-smoke-93b0597` created run `39004299322`, which is waiting for owner approval. Its result will identify the failed request step and HTTP status only. The candidate remains draft and production remains on Railway.
- The owner approved protected smoke run `39004299322`. Sign-in succeeded, but the first authenticated `/v1/me/state` request returned HTTP 503; this is an Edge fallback that hides the underlying failure. `651d30b` adds a protected, exact-project staging diagnostic that exercises state and its component SQL functions for the test account inside a rolled-back transaction, logging only fixed labels and SQLSTATEs. Seven focused smoke/diagnostic tests, Python compilation, workflow YAML parsing, and whitespace checks passed. A new protected diagnostic run is needed before changing the API or staging data.
- The owner approved protected SQL diagnostic run `39004746801`; state, daily selection, history, saved, and stats all returned `ok` inside the rollback transaction. This narrows the HTTP 503 to the candidate Edge/auth/PostgREST request path rather than those SQL bodies. `0a2d8d3` makes the protected authenticated smoke collect the status of all four learner endpoints in one pass, with only fixed labels and HTTP statuses logged; eight focused tests, Python compilation, and whitespace checks passed. Another protected smoke run will reveal whether only state fails or authenticated routes generally fail.
- The owner approved protected smoke run `39005133121`: topics and stats succeeded, while state and achievements returned HTTP 503. Older RPCs work, but these newer ones fail through Edge despite a successful direct SQL state call, so a stale PostgREST schema cache is a leading hypothesis, not yet a confirmed cause. `1a9f7ef` adds a one-project protected cache reload and reloads after future verified migrations; 22 local runner guard tests passed. `1499c7b` logs only incident ID, upstream component and HTTP status inside Edge while preserving the generic client 503; all 56 handler tests and TypeScript typecheck passed. `1a59c6d` documents the repair path. The next protected staging reload and smoke will test the hypothesis; no production change occurred.
- Protected cache reload `39005584080` succeeded, but authenticated smoke `39005682552` still returned HTTP 503 for state and achievements. The owner approved incremental SQL run `39005800949`, which applied and verified migrations 0074–0084 and refreshed staging PostgREST. `79ce72c` made the rolled-back SQL probe run under `service_role`; protected diagnostic `39005956071` returned SQLSTATE `42501` for state, daily, and achievements, while history, saved, and stats passed. This identifies a restricted Auth-table read in the service-only RPCs rather than a cache-only failure.
- `cd80f9a` adds migration 0085: only the five service-only RPCs that read `auth.users` or `auth.sessions` become security-definer functions, with an empty-search-path guard and explicit denial to `anon`/`authenticated`. The staging runner probes the privilege transition, and the schema contract now tracks all five definitions. Disposable PostgreSQL 16 ran 27 focused tests, including service-role calls with Auth tables inaccessible; Ruff `F,E9` and whitespace checks passed. Migration 0085 has not yet run in staging, the matching Edge commit is not deployed, and the candidate PR remains draft with 29 API paths still unported.
- Hosted CI on `416e2e6` found one cutover fixture that recreated the new cluster-wide `anon` role in a second database; `1545683` fixes that fixture. Four focused PostgreSQL tests passed locally, then all three hosted checks passed on `1545683` (718 backend tests). The owner approved staging SQL run `39013339262`, which applied and verified migration 0085 and refreshed PostgREST. The matching Edge deploy `39013496426` passed. Authenticated staging smoke `39013630407` then passed learner state, topics, stats, and achievements. Production remains on Railway; #419 stays draft until the other 29 API paths and full acceptance checks are complete.
- `98d1ae5` ports private editorial taxonomy with any-of read capability, bounded cursor pages, and current-session/MFA checks. `ffeef45` ports owner activity with topic filtering; `a39ef59` ports review-only legacy batch entries without exposing their stored source bodies. Their disposable PostgreSQL role, pagination, and schema-contract tests passed; Edge handler tests and typecheck passed. The test `service_role` now mirrors Supabase's RLS bypass. Local candidate parity is 47 of 73 paths, with 26 unported. Migrations 0086–0088 and these routes are not staged; the deployed candidate remains `1545683` and production remains on Railway.
- The full backend suite reached **720 passed, 1 failed**: the cutover fixture still matched the previous cluster-wide service-role declaration. `8a0bf75` fixes that fixture string; the cutover case, all three new route tests, and schema contract then passed together (**5 passed**) on disposable PostgreSQL. Ruff `F,E9`, Edge TypeScript, Node handler tests, and diff checks passed. Hosted full CI and protected staging remain pending for this batch.
- All three hosted quality jobs passed on `56ebad8`. `3e6199c` ports the reviewer queue's revisions, legacy, and published views with bounded pagination, snapshot-consistent total, validated filters, and the any-of read gate. A disposable PostgreSQL test compares the empty/default views with FastAPI, exercises populated legacy/published branches and service-role access; the schema contract, Edge TypeScript, and 60 handler tests passed. Candidate parity is 48 of 73 paths, with 25 remaining. Migration 0089 and Edge queue route have not been staged.
- `5b9e83b` adds the GET half of editorial concept revision history with existing-concept checks, bounded cursor pagination, and the same review capability gate. Its disposable PostgreSQL test matched the existing FastAPI response and verified pagination, MFA, and service-role access; Edge typecheck and 61 handler tests passed. The POST half is still unported, so complete-path parity remains 48/73. Migration 0090 and this route are not staged.
- All three hosted checks passed on `4bb802a`. `d7783bc` adds review-only generation-job list and detail RPCs with the existing visible-field allowlist, exact UTC timestamp format, and SHA-256 version token matching FastAPI. The disposable PostgreSQL test created a real queued job, compared both responses and token with FastAPI, and verified service-role and MFA boundaries; the schema contract, Edge typecheck, 62 handler tests, Ruff, and whitespace checks passed. Candidate parity is 50 of 73 paths, with 23 remaining. Migrations 0086–0091 and their routes await staging.
- The approved authenticated staging smoke on `1545683` passed learner state, topics, stats, and achievements. The candidate remains draft for full issue scope. Migration 0092 and its Edge route port reviewer generation-supply counts and configuration flags; local SQL parity with FastAPI, role/MFA checks, schema contract, Edge typecheck, and handler tests passed. Candidate parity is 51 of 73 paths, with 22 remaining. Migrations 0086–0092 and their routes await staging.
- Hosted CI on `90044b9` found a reviewer-pagination test assumption about the shared database. `83e0e92` makes that test assert its own rows and advance through every page; its focused PostgreSQL check passed. Migration 0093 and its Edge route add legacy-enrichment eligibility with the existing published-lesson filters, role/MFA boundary, and configuration state. Local SQL/FastAPI parity on a published legacy lesson, schema contract, Edge typecheck, and handler tests passed. Candidate parity is 52 of 73 paths, with 21 remaining. Migration 0093 is not staged.
- Hosted CI on `4dac694` found that the exhausted-topic test could select an inactive fixture topic; `d6bee87` restricts the selection to active published lessons. All three hosted quality jobs then passed. Protected SQL run `39017139079` applied and verified migrations 0086–0093 only in staging; Edge deploy `39017303094` and authenticated learner smoke `39017399735` passed on the matching commit. The smoke checked learner state, topics, stats, and achievements. Migration 0094 adds private concept-timeline reads with the existing opaque cursor format; local FastAPI/SQL pagination parity, role/MFA checks, schema contract, TypeScript, and handler tests passed. Candidate parity is 53 of 73 paths, with 20 remaining. Migration 0094 is not staged.
- Migration 0095 adds reviewer legacy-enrichment batch summaries and their exact version tokens and per-entry counts. The focused disposable PostgreSQL parity and schema-contract checks passed, as did Edge TypeScript and handler tests. Candidate parity is 54 of 73 paths, with 19 remaining. Migrations 0094–0095 are not staged.
- Hosted CI on `b2fd9fd` found revision-history timestamps sometimes lost a trailing zero in their microsecond fraction. Migration 0096 makes editorial UTC formatting exact and applies it to revision history, activity, and concept timeline. The queue keeps its existing PostgreSQL JSON timestamp format because that is also what FastAPI returns. Five focused disposable-PostgreSQL tests, including deterministic trailing-zero comparisons with FastAPI, passed; the schema contract was regenerated. Migrations 0094–0096 await staging.
- All three hosted PR quality jobs passed on `27be3aa`; protected staging SQL was requested for migrations 0094–0096 under tag `supabase-api-staging-incremental-27be3aa`. Migration 0097 ports the owner-only notification-policy update with the existing three-lock order, current authority recheck, version compare, and audit event. Local SQL/schema parity, role/MFA checks, Edge TypeScript, and 67 handler tests passed. Candidate parity is 55 of 73 paths, with 18 remaining; migration 0097 is not staged.
- Protected SQL run `39018239902` applied and verified migrations 0094–0096 in staging; its matching Edge deployment awaits a separate GitHub approval. Migration 0098 adds the owner delivery overview with bounded visible batches, policy, counts, overdue total, daily usage, and server-derived sender setup status. Local FastAPI/SQL parity with a private batch, role/MFA checks, schema contract, Edge TypeScript, and 68 handler tests passed. Candidate parity is 56 of 73 paths, with 17 remaining. Migrations 0097–0098 are not staged.
- Protected Edge run `39018413405` deployed commit `27be3aa` after the verified SQL; learner smoke `39018579596` is waiting at a separate protected gate. Migration 0099 adds owner-only requeue of a failed notification under the same three-lock order, durable attempt budget, version compare, and audit event; it never sends mail during the request. Local FastAPI/SQL parity, stale and permission checks, schema contract, Edge TypeScript, and 69 handler tests passed. Candidate parity is 57 of 73 paths, with 16 remaining. Migrations 0097–0099 are not staged.
- Authenticated learner smoke `39018579596` passed on staging commit `27be3aa`. Migration 0100 adds the owner-only operations readout: two worker freshness states, generation and email job counts, provider budget, and server-derived feature flags. Local FastAPI/SQL aggregate parity, role/MFA checks, schema contract, Edge TypeScript, and 70 handler tests passed. Candidate parity is 58 of 73 paths, with 15 remaining. Migrations 0097–0100 are not staged.
- Migration 0101 ports the owner overview with the FastAPI UTC date window, historical learner completion counts, review and queue metrics, and role/MFA checks. Focused disposable-PostgreSQL parity and schema contract tests, Edge TypeScript, and 71 handler tests passed. Candidate parity is 59 of 73 paths, with 14 remaining; migrations 0097–0101 are not staged.
- Migration 0102 ports the owner reviewer metrics page with bounded UUID pagination, historical approval/publication counts, attribution snapshots, and private evidence protection. Local FastAPI/SQL parity, privilege and role/MFA checks, schema contract, Edge TypeScript, and 72 handler tests passed. Candidate parity is 60 of 73 paths, with 13 remaining; migrations 0097–0102 are not staged.
- Migration 0103 ports the owner event feed with bounded UTC cursor pagination and allowlisted service, review, workflow, and account event fields. Local FastAPI/SQL filter/cursor parity, role/MFA and privilege checks, schema contract, Edge TypeScript, and 73 handler tests passed. Candidate parity is 61 of 73 paths, with 12 remaining; migrations 0097–0103 are not staged.
- Migration 0104 ports versioned reviewer access changes with account locking, audit evidence, MFA, and last confirmed administrator protection. Focused disposable-PostgreSQL, schema contract, Edge TypeScript, and 74 handler tests passed. Candidate parity is 62 of 73 paths, with 11 remaining; migrations 0097–0104 are not staged.
- Migration 0105 adds reviewer invitations using a read-only account/identity check, the Supabase Auth invite endpoint for new users, and an authority-rechecking membership/audit transaction. The callback is restricted to an exact allowed origin; existing Auth users are enrolled without another email. Focused PostgreSQL authority, identity, privilege, and audit checks, Edge TypeScript, and 77 handler tests passed. Counting all methods in each route-matrix row, 62 of 73 unique API paths are now fully candidate, two have a candidate GET but an unported POST, and nine have no candidate methods; 11 paths still need work. Earlier progress counts counted a new method on an already listed path as a new path. Migrations 0097–0105 are not staged. The full backend suite and hosted checks remain pending.
- All three hosted quality jobs passed on `2ed9b37`. Protected SQL run `39022126590` applied and verified migrations 0097–0105 only in staging; its matching Edge deployment is waiting at a separate protected gate. Migration 0106 ports generation-job cancellation with the account/catalog lock order, current authority checks, exact Python-compatible request receipts, version token, status transition, and audit event. The focused PostgreSQL/FastAPI replay parity test, schema contract, TypeScript, and 78 Edge handler tests passed. Counting full route-matrix rows, 63 of 73 API paths are fully candidate, two are GET-only candidates, and eight have no candidate method; 10 paths still need work. Migration 0106 is not staged.
- Protected Edge deployment `39022724919` and authenticated learner smoke `39022857888` passed on matching commit `2ed9b37`; the latter checked state, topics, stats, and achievements. All three hosted quality jobs passed on `23a71f6`. Commits `ae448cd` and `34f1f61` add legacy batch creation/actions and bounded generation demand with current role/MFA checks, account/catalog lock order, durable receipt replay, audit evidence, and server-side quota enforcement. Migrations 0107–0109 and their handler changes passed 25 focused disposable PostgreSQL/schema tests, 81 Node handler tests, Edge TypeScript, and diff checks. Counting every method on each path, 66 of 73 API paths are fully candidate, one has only GET candidate, and six have no candidate method; seven paths remain. Migrations 0106–0109 are not staged; production clients remain on Railway and PR #419 stays draft until the full #416 gates pass.

### v1.10.14 production migration ledger — 2026-10-10

- The owner reported that production migrations `0044_public_profile_bio_choice.sql` and `0045_editorial_authenticator_choice.sql` were applied after preparation PR #412 merged. Commit `3c76e95` records that operator attestation in `backend/migrations/applied.txt`; it does not itself run SQL or prove the target schema.
- This workspace has no production `DIRECT_URL` or open Supabase session, so an independent read-only target-schema check was unavailable. The protected production schema check remains required before mobile publication, and Railway's pre-deploy schema check must guard the API and workers. Do not infer deployment success from the ledger.
- The ledger PR targets `develop` before the v1.10.14 `develop` → `main` release PR can pass its required migration filename check.
- [Ledger PR #413](https://github.com/Coding-Moves/one-concept/pull/413) contains the operator record. [Draft release PR #414](https://github.com/Coding-Moves/one-concept/pull/414) targets `main` from `develop`; keep it draft until #413 merges and release checks pass. Neither PR authorizes production deployment or mobile publication by itself.

### v1.10.14 release preparation — 2026-10-10

- Scope: prepare the next release on `codex/v1-10-14-release-prep` from current `develop` with app version 1.10.14 and its one-time What's New card. Keep native runtime 1.10.8 because this release adds no native package or app-config change. Open a focused PR into `develop`; the production release remains a separate `develop` → `main` PR.
- Card highlights will cover repeating an unfinished daily lesson until Learned, refreshing Today when the app resumes, and the profile photo, bio, sharing, and connection improvements now in `develop`. Validate the exact version/card match and mobile TypeScript.
- Release gates at preparation: authenticator PR #411 merged into `develop` as `619f1f0`. Migrations 0044 (public bio choice) and 0045 (authenticator choice) still needed operator application before opening the release PR.
- Commits: `95e317d` records scope; `32f7bd4` bumps the marketing version and adds the matching three-highlight card; `5d902af` integrates merged #411 without rewriting either history. No native runtime or package change was made in this chunk.
- Validation: clean Node 24 locked install, mobile typecheck, exact version/card/runtime check, and `git diff --check` passed. The full local mobile suite had one failing existing `publicConfig.test.mjs` stderr assertion; all other cases passed. Hosted mobile, backend, and website checks passed. The existing version-keyed dismissal flow was inspected and reused.
- [Preparation PR #412](https://github.com/Coding-Moves/one-concept/pull/412) passed all three hosted checks and merged into `develop` as `6b0fa83`. The owner's later migration attestation is recorded above; protected target-schema verification remains a release gate.

### Optional authenticator for the editorial website — 2026-10-10, PR #411 open

- Scope: one PR into `develop` for a per-account owner/reviewer Settings switch. Existing editorial accounts continue to require an authenticator by default. Turning it off requires a fresh verified TOTP challenge; turning it on restores MFA gating for that account. Supabase factors remain enrolled.
- `d90117f` adds the versioned, self-only API, audited database choice, signed TOTP timestamp check, and reviewed schema contract in migration 0045. `6bc1ac7` adds the switch and code confirmation for both roles. `8d3980f` tests revoked and spoofed changes. The unrelated release checkout remains untouched.
- Validation: 54 editorial authority/API/security/schema tests passed against disposable PostgreSQL 16; the four focused authenticator API cases passed again after the authority follow-up. Website typecheck, 17 unit tests, fixture production build, all 48 browser tests, desktop visual inspection, Ruff `F,E9`, and `git diff --check` passed. The initial build without public fixture variables stopped before bundling; the configured build passed. No live Supabase factor or physical device was used.
- [PR #411](https://github.com/Coding-Moves/one-concept/pull/411) targets `develop`. After bio PR #407 and Connections PR #408 merged, this branch integrated both; the combined 0044/0045 schema contract (21 tests) and focused authenticator/security tests (16 tests) passed against disposable PostgreSQL 16. All three hosted checks passed on `c604328`. Migration 0045 is not marked production-applied. Live Supabase owner/reviewer verification remains for release.

### Profile photo save flow — 2026-10-10, PR #406 open

- Scope: [#401](https://github.com/Coding-Moves/one-concept/issues/401) fixes the camera/gallery path that stays on the phone's crop screen. The isolated `codex/401-profile-photo-save` branch targets `develop`; the unrelated release checkout and its uncommitted log remain untouched.
- `4962234` center-crops the normalized JPEG and preserves orientation; `d2a9341` returns avatar write failures to Edit profile; `b4ace83` removes the device crop UI and adds a square preview with Save/Cancel, visible retry errors, and an account-owned Android pending picker marker cleared at sign-out. Self-review led to `33aaeb9`, which removes an unnecessary gallery permission gate while retaining the camera check. The later deep review added `4d95195`, rejecting excessive decoded image dimensions before resize and giving a clearer retry hint. Private storage and the explicit public-avatar opt-in remain unchanged.
- Validation: nine focused backend/profile-sharing tests passed against disposable PostgreSQL 16; Ruff `F,E9`, mobile typecheck, Expo web export, light/dark 320px browser photo preview/cancel/failure/retry/save regression, and `git diff --check` passed. The full mobile Node suite passed 96 of 97 tests; the existing `publicConfig.test.mjs` stderr assertion fails under this local runtime (exit is correct but stderr is empty). Camera/gallery completion, Android activity recreation, and private-bucket behavior on a physical production device remain unverified and must be checked before release.
- Related follow-ups are [bio #402](https://github.com/Coding-Moves/one-concept/issues/402), [shared profile #403](https://github.com/Coding-Moves/one-concept/issues/403), [sharing settings #404](https://github.com/Coding-Moves/one-concept/issues/404), and [Connections #405](https://github.com/Coding-Moves/one-concept/issues/405).
- [PR #406](https://github.com/Coding-Moves/one-concept/pull/406) remains open. All three hosted checks passed on `97811a6`; the branch was merged with current `develop` to resolve the work-log overlap. The PR description closes #401 on merge; device and production-storage checks remain release acceptance.

### Dependabot React renderer recovery — 2026-10-10

- Scope: [PR #391](https://github.com/Coding-Moves/one-concept/pull/391) now combines the original React 19.2.8 commit from [#390](https://github.com/Coding-Moves/one-concept/pull/390) with the React DOM 19.2.8 commit. Both original bot commits remain in the integration history, and the current `develop` comparison changes only the two mobile package files plus this work-log entry. Dependabot closed [#387](https://github.com/Coding-Moves/one-concept/pull/387) after #389 already resolved `@react-navigation/native` 7.5.0 in the lockfile.
- Validation: a clean Node 24 `npm ci`, mobile typecheck, all 97 mobile tests, matching-version server-renderer smoke test, and fixture-configured Expo exports for web, Android, and iOS passed. All three hosted PR checks passed; a current-head review and PR-specific merge confirmation remain pending. No production release or native runtime change was made.

### Editorial review handoff and first future-refill plan — 2026-10-10

- Scope: one PR into `develop` for automatic private correction requests after a reviewer's change request, the published/manual review-page regressions, symbolic MCQ option validation, and a curated five-subject launch backlog for future refill. No lesson is auto-approved or published.
- Live owner-site check: 120 existing lessons await human review; the published Blue-Green Deployment detail and historical revision show structured content and no red validation banner. An approved-but-stale revision must still show a real warning. The Software Engineering AI requests page has no pending new curriculum and its generation flag is paused.
- Focused commits: `3138911` preserves symbolic answer choices, `7ecc96a` clears inherited AI provenance from manual edits, `33a9055` queues one correction from a change request, `8f06e1f` packages five sourced plans and the rollout procedure, `c9f7014` preserves legacy-worker authority and covers queue/revocation cases, `07133a3` exposes the correction switch to owners, and `6445e2d` verifies the plan import and owner status. `551f491` merges current `develop` without rewriting those commits.
- Validation: the complete backend PostgreSQL suite passed **585 tests**; the focused editorial/legacy suite passed **55 tests**, and the final plan-import/owner-status checks passed **2 tests**. The website passed 17 unit and 46 browser tests, TypeScript, and a fixture-configured production build. Ruff `F,E9` and `git diff --check` passed. No paid provider call or production import, variable change, deployment, or lesson publication was performed.
- Handoff: [PR #400](https://github.com/Coding-Moves/one-concept/pull/400) targets `develop`; hosted checks are pending. A separate `develop` to `main` release and operator-controlled five-plan import/refill activation follow review of this PR. Reviewers still decide and publish each card.

### Simple public-profile choices and visitor preview — 2026-10-10, PR #410 open

- Scope: [#404](https://github.com/Coding-Moves/one-concept/issues/404) on `codex/404-sharing-settings`, based on bio PR #407. Profile sharing now shows a clear Private/Shared state, three identity choices, an optional learning-highlights group, and one primary review/publish or view/share action.
- `3e7a549` reuses the anonymous-field card in the published share preview. `0d55ae9` adds an actual draft visitor preview, shorter choices, version-conflict recovery that preserves draft edits until an explicit reload, and a 320px publish/visitor/conflict browser flow. `3bc24e1` fences in-flight reads and writes against account changes. Deep review added `dcca860`, covering minimal publish, an expanded update, explicit conflict recovery, unpublishing and the revoked link in the browser flow.
- Validation: mobile typecheck, Expo web export, the 320px browser flow including minimal publish, change preview, conflict recovery, unpublish and revoked-link handling, visual inspection of the choices and review sheet, and `git diff --check` passed. The full local mobile suite passed 96/97 tests; the existing `publicConfig.test.mjs` stderr assertion fails under this local Node runtime. Physical-device large-text, screen-reader, offline, and account-switch acceptance remain to be checked before release.
- [PR #410](https://github.com/Coding-Moves/one-concept/pull/410) targets `develop` so hosted checks run. Its current diff includes #407, #408, and #409; merge those PRs in that order first so the remaining diff is the sharing-settings chunk. The combined visitor flow was updated for #408's simpler Connections entry. No migration or backend API change in this chunk.

### Shared-profile visitor card — 2026-10-10, PR #409 open

- Scope: [#403](https://github.com/Coding-Moves/one-concept/issues/403) on `codex/403-shared-profile`, based on bio PR #407 because both change the visitor view. Browser and app visitors see a responsive card built solely from the anonymous public allowlist, with Connect near identity in the app. The browser link opens the app to connect.
- CI repair: the merge of current `develop` at `29cc549` retained an obsolete public-page block after the new renderer, causing Ruff to stop on unexpected indentation. `b6e1e3b` removed the stale block; backend Ruff `F,E9`, the two public-page rendering tests, and `git diff --check` passed locally. All three hosted checks passed on `385e362`.
- `6144529` replaces the plain browser text with an escaped, no-script card, scoped photo origin in CSP, and focused rendering tests. `717e1bc` adds the in-app visitor card and Connect flow. Visual review prompted `5a70444` to replace ambiguous browser glyphs with vector icons.
- Validation: ten focused backend tests passed against disposable PostgreSQL 16; Ruff F/E9, mobile typecheck, web export, the 320px visitor/Connect browser flow, and `git diff --check` passed. The full local mobile suite passed 96/97 tests; the existing `publicConfig.test.mjs` stderr assertion fails under this local Node runtime. Physical Android/iOS deep links and signed storage photos remain manual release acceptance.
- [PR #409](https://github.com/Coding-Moves/one-concept/pull/409) targets `develop`. Bio PR #407 and Connections PR #408 have merged; the remaining diff is the visitor-card chunk. The visitor-modal overlap with #408 was resolved in this branch without rewriting commits. Issue #403 stays open for device acceptance.

### Saved bio visibility and public choice — 2026-10-10, PR #407 open

- Scope: [#402](https://github.com/Coding-Moves/one-concept/issues/402) on `codex/402-profile-bio` gives the owner a visible saved bio and adds a separate, default-off public bio choice. The anonymous API, in-app visitor view, and browser page show it only after explicit publication. This is separate from the photo PR and the later shared-profile, sharing-settings, and Connections issues.
- `571e20f` adds the default-off migration, server allowlist, escaped browser bio, and privacy tests; `bb6ad61` shows the saved bio on the owner Profile; `1c3c823` adds the sharing switch, publish review, and public preview; `6913e3c` shows the visitor bio and unmounts its modal on close so it cannot trap focus over Edit profile; `5ac803f` records the migration in the schema contract.
- Validation: eight profile-sharing PostgreSQL tests and the schema contract test passed against disposable PostgreSQL 16; mobile typecheck, three sharing unit tests, Expo web export, the 320px owner/review/visitor/clear browser flow, and `git diff --check` passed. The full local mobile suite passed 96 of 97 tests; the existing `publicConfig.test.mjs` stderr assertion fails under this local Node runtime. Physical-device editing, sign-out/account-switch display, and production migration remain unverified.
- [PR #407](https://github.com/Coding-Moves/one-concept/pull/407) targets `develop` and keeps #402 open for staged device and deployment acceptance. The published diff was self-reviewed with no further code findings; hosted checks are running. This branch merges cleanly with the open photo PR's current head without rewriting either set of commits.

### Repeat unfinished daily lessons — PR open

- Outcome: carry the exact unfinished lesson in a followed subject onto later local days until Learned. Follow changes take effect on the next assignment day. Once followed lessons are learned, Today offers a review from a followed subject or waits for publication. Completed dates stay fixed.
- Scope: [lesson issue #397](https://github.com/Coding-Moves/one-concept/issues/397) and [foreground issue #398](https://github.com/Coding-Moves/one-concept/issues/398) share branch `codex/repeat-unlearned-lessons` and [PR #399](https://github.com/Coding-Moves/one-concept/pull/399) into `develop`. The existing release branch and its uncommitted work remain untouched.
- `7da20e0` carries unfinished assignment rows, keeps selection and reviews within follows, aligns the compact state pointer, and adds database/API regressions. `d1d24de` refreshes account progress and topics on foreground return/reconnect without dropping queued actions. `e9532a7` updates the yearlong simulation to verify activity stays within follows.
- Validation: 93 focused backend tests and the complete 580-test backend suite passed against disposable PostgreSQL 16; mobile typecheck and all 97 mobile tests passed; targeted Ruff `F,E9` and `git diff --check` passed. The published PR diff was reviewed with no further code findings, and all three hosted checks passed on `d53ec86`. A physical-device foreground check and production rollout remain unverified. The PR remains open.

### Connections screen clarity — 2026-10-10, PR #408 open

- Scope: [#405](https://github.com/Coding-Moves/one-concept/issues/405) on `codex/405-connections-ux` simplifies finding a friend and managing the private one-way list. Separate photo, bio, shared-profile card, and sharing-settings PRs remain independent.
- Intended commits: expose only explicitly shared avatars in the owned relationship list; support owner-fenced block from a list entry; simplify the mobile scan/link/list/actions; cover privacy and small-screen flows; document validation and handoff.
- `4b07a4b` exposes only currently shared avatars and adds owner-fenced list blocking with privacy tests; `1a4c66c` fully closes the visited-profile modal before returning to Connections; `3eb1af9` simplifies scan/link/list/actions and adds account-bound API and browser flow coverage; `2412f02` corrects lock order for blocking; `6795f3b` keeps the list available if photo Storage fails. Deep review added `5423dc0`, bounding all photo Storage lookups so a stalled bucket cannot delay the list.
- Validation: ten focused relationship tests passed initially on disposable PostgreSQL 16, then three focused avatar/block tests passed after the timeout fix; Ruff `F,E9`, mobile typecheck, four Connections unit tests, Expo web export, light/dark 320px browser flows with offline, Connect, view, disconnect and revoked-profile block, visual screenshot checks, and `git diff --check` passed. The full local mobile suite passed 97 of 98 tests; the existing `publicConfig.test.mjs` stderr assertion fails under this local Node runtime. Native QR scanning, device accessibility, real second-account behavior and deployed Storage remain unverified.
- [PR #408](https://github.com/Coding-Moves/one-concept/pull/408) targets `develop`; its published diff was mergeable and all three hosted checks passed on `71df626`. It was also checked to merge cleanly with the current photo and bio PR heads. Issue #405 stays open for device and two-account acceptance.

### Existing-card completion, 2026-10-09 — in progress

- Live owner-site follow-up on 2026-10-10: all 125 existing published lessons have reached a private review-ready revision or have already been published; 120 await human decisions and five have been published. This closes the preparation count, not the human review and publication work.
- Outcome: prepare complete private revisions for all 125 existing published lessons; human reviewers retain approval and publication. This chunk aligns legacy-only summary and example length checks with the published lesson schema without changing new-lesson generation or source checks.
- Live owner-site evidence: Software Engineering has 24 of 25 lessons ready for review or published; Message Queues alone exhausted three attempts with `example_length`. Linux & Systems batch `#ED025056` has 18 ready and 7 queued. The Railway browser session expired before the next on-demand run; its daily scheduled worker remains configured. Other subjects have not started.
- `8657d72` lets `generation.validate` accept an optional worked-example maximum; `fd641d0` does the same for summaries. The legacy path uses published `LessonBody` limits of 500 and 600 characters while ordinary generation retains 300 and 420. Boundary regressions reject over-limit content. No source or human-review gate changes.
- Validation: all 26 focused tests passed against disposable PostgreSQL 16, Ruff `F,E9` and `git diff --check` passed. [PR #394](https://github.com/Coding-Moves/one-concept/pull/394) passed all three hosted checks and merged into `develop` as `e324268`. Production rollout and the remaining subject batches are pending.
- Release preparation: `b3f19a2` bumps the app to 1.10.13 and adds its matching one-time What's New card; native runtime remains 1.10.8. Mobile typecheck, version/card check and `git diff --check` passed. No migration appears in the current `main` → `develop` diff. The preparation and production release PRs are pending.

### Editorial owner session recovery — merged into develop

- Scope: keep a refreshable owner/reviewer session usable after a browser tab has been idle, while retaining account-switch and revoked-authority fences. This is a focused website fix for the 125-card review effort; it does not extend a genuinely expired or revoked session.
- The client now obtains the current Supabase session before private API requests, sends the refreshed access token, and ignores a late denial from an older token. Temporary refresh errors preserve unsent work for retry. Account identity is checked before the request so one account's data cannot appear under another.
- Validation: admin typecheck, 17 unit tests, fixture production build, all 44 browser tests before the follow-up, focused 403 recovery browser regression after it, `git diff --check`, and all three hosted checks passed. [PR #382](https://github.com/Coding-Moves/one-concept/pull/382) merged into `develop` as `2bb123d`. Production behavior remains unverified until deployment.
- Final review found that a 403 capability denial could prevent the same signed-in account from using Refresh account access after permission was restored. `941245c` preserves only that account identity while clearing private state; the focused browser regression, repeated typecheck and 17 unit tests passed.

### Legacy complete-card validation follow-up — in progress

- The owner authorized a temporary exception to per-PR merge confirmation solely for preparing complete private revisions of the 125 existing lessons. `bddf3a7` records the bounded exception in `AGENTS.md`; [PR #381](https://github.com/Coding-Moves/one-concept/pull/381) merged into `develop` as `8baa62b` after all three hosted checks passed and the owner specifically approved that merge. Identity, checks, release gates, and human review/publication remain required. The exception ends when all 125 are ready for human review or already reviewed/published, or on revocation.
- Release [PR #379](https://github.com/Coding-Moves/one-concept/pull/379) merged as `ef411d5`; Railway `api`, `reminders`, and `pool-topup` run that SHA, `/health` reports a reachable database, and the guarded v1.10.11 release workflow passed its production-schema, OTA, and tag steps. This release did not publish any lesson automatically.
- Live Software Engineering batch `#066794E6` is paused after a bounded run. Its second paid canary produced a structurally valid Database Indexes draft, then the larger pass saved 14 private drafts but left 4 entries failed with repeated `content_invalid`, 1 blocked for a missing source, and 1 queued. The worker completed after the pause. Existing drafts are preserved for human review; no failed item was silently published. The worker's service-level `LEGACY_ENRICHMENT_BATCH_SIZE` is 60; do not resume this batch before the fix is deployed.
- `fde0f30` aligns the legacy Gemini prompt with the actual summary/example quality limits and prohibited filler, records content-free validation reason codes, and adds regressions. Focused tests against disposable PostgreSQL 16: **24 passed**. Ruff `F,E9`, `git diff --check`, and all three hosted PR quality gates passed. A new one-call production pilot remains pending; this fix has not reached production.
- [PR #380](https://github.com/Coding-Moves/one-concept/pull/380) merged into `develop` as `ada17b6` after its PR-specific confirmation. The current `develop` → `main` diff has no migration or native change. `0f74cce` prepares the separate v1.10.12 release with a matching nonempty What's New card and unchanged native runtime 1.10.8; local mobile typecheck and version/card checks passed. [Preparation PR #383](https://github.com/Coding-Moves/one-concept/pull/383) targets `develop`; the production release PR and pilot are pending. A retry can stage the one queued card; failed or blocked entries need a new eligible batch after this one ends. The 25-draft review-capacity limit and human decisions may prevent all five subjects from being ready at once.

### Legacy grounded-card recovery — in progress

- Production diagnosis on 2026-10-08: the first 25-card Software Engineering batch ended with 3 published, 2 ready, 14 failed, and 6 blocked. A replacement batch `#066794E6` was paused after one paid REST pilot returned `source_missing`; its other 19 entries were queued at that point. A separate pending AI correction became ready for human review. `pool-topup` used a temporary service-level `LEGACY_ENRICHMENT_BATCH_SIZE=1` override for the pilot. No remaining lesson was published by that recovery work.
- In the production Gemini project, an exact full-card trial using Google Search plus JSON MIME/schema returned no grounding metadata, while a searched prose note followed by a marked JSON card returned a complete three-question card and grounding chunks. `3d33fa2` changes only the legacy request/parser to that format and retains the hard source requirement. All 21 focused backend tests pass against disposable PostgreSQL 16; Ruff `F,E9` and `git diff --check` pass. Production behavior still needs a one-call worker canary after release.
- [PR #377](https://github.com/Coding-Moves/one-concept/pull/377) passed all three hosted checks and merged into `develop` as `9b78ac4` after the owner's PR-specific confirmation. [PR #378](https://github.com/Coding-Moves/one-concept/pull/378) merged as `d162a61` with app version 1.10.11, its matching What's New card, and this handoff log. Native runtime stays 1.10.8. Local mobile typecheck, version/card check, and all hosted PR checks passed.
- [PR #379](https://github.com/Coding-Moves/one-concept/pull/379) then released that diff to production as recorded above. Review-capacity limits and human decisions still prevent all subjects from becoming ready at once.

### v1.10.10 release preparation — PR #374

- Scope: release merged [PR #373](https://github.com/Coding-Moves/one-concept/pull/373)'s legacy-enrichment worker recovery from `develop` to production after the normal release gates. Before preparation, the `main` → `develop` diff contained only backend worker code, tests, and operator guidance; no database migration or native module changed.
- `711c31f` bumps the app to 1.10.10 and adds its matching one-time learner-facing What's New card. Native runtime stays 1.10.8. Mobile TypeScript typecheck, exact version/card/runtime check, and `git diff --check` passed. [PR #374](https://github.com/Coding-Moves/one-concept/pull/374) targets `develop`; all three hosted checks passed on `2715a03`. Owner merge remains pending.
- After #374 merges, recheck the final `develop` → `main` diff for the version and card, then open the production release PR. Production merge and mobile publication remain separate. After deployment, run one paid Gemini call, inspect its diagnostic/entry result, and only then resume the remaining Software Engineering entries. The remaining cards are not yet prepared or published.

### Legacy enrichment recovery — in progress

- The first live Software Engineering batch prepared 5 of 25 private drafts; 6 entries were blocked and 14 failed after the bounded calls. Four drafts were approved, and one was sent for AI correction. The earlier worker saved generic failure codes, so the exact provider responses for those 20 entries cannot be reconstructed from the owner site. No further paid batch or production change is part of this repair.
- `5a2fb8d` parses all non-thought Gemini text parts, rejects incomplete/safety-stopped responses explicitly, allows a larger bounded output for a complete card, and saves safe failure codes and entry IDs for the next run. The operator guidance and handoff log are a separate documentation commit.
- Validation: 16 focused backend tests passed against disposable PostgreSQL 16; Ruff `F,E9` passed. The full backend run reached 509 passing tests without a failure, then stalled near 89% and was interrupted after 10 minutes; hosted PR CI is needed for an authoritative full-suite result. The live provider behavior and recovery of the remaining 20 lessons require a later release and a one-call paid pilot. Existing generic failure codes will not be rewritten.
- [PR #373](https://github.com/Coding-Moves/one-concept/pull/373) targets `develop`; all three hosted checks passed on `3bce361`. It references open issue #368 without closing it. Merging this feature PR will not deploy production. After a separate release and healthy worker deployment, use a one-legacy-call pilot, inspect the new failure code, and only then resume the remaining subject entries. The worker may also run queued AI corrections first.
- Second review found a malformed numeric/list summary or example could raise outside the classified provider errors and strand a worker claim. `01d0712` classifies those fields as retryable `content_invalid` and stores the validated trimmed text. The focused disposable-PostgreSQL suite passes **19 tests**; Ruff `F,E9` and `git diff --check` pass. All three hosted checks passed on the follow-up head `33d7bc8`.

### v1.10.9 release preparation — in progress

- The owner requested a production release PR before starting one manually selected Software Engineering existing-card batch per day. PR #369 is still open against `develop`, so its reviewed-card workflow must land before the `develop` → `main` release PR can include it.
- [PR #370](https://github.com/Coding-Moves/one-concept/pull/370) prepares the release on `develop`. `976655d` bumps `expo.version` to 1.10.9 and adds the matching one-time What's New card for card information, reviewer attribution, and complete reviewed lessons. This is a JavaScript-only release; the native `runtimeVersion` stays 1.10.8. Mobile typecheck, `git diff --check`, and all three hosted PR checks passed. PRs #369 and #370 remain open pending their PR-specific merge choices; the `develop` → `main` release PR cannot include their work until both land. Production deployment, paid Gemini calls, and approval of existing lessons have not occurred.
### #368 existing-card rehearsal and reviewer credit — PR #369 open

- Daily subject preparation follow-up: the owner will manually start one subject batch each day and use a paid Gemini key for one week. `a90a47b` expands only the legacy worker's per-run allowance from 3 to 75 calls (25 cards × up to 3 attempts); `64c6f02` clarifies the matching owner-site budget. The rollout explains the daily cron, shared call cap, review capacity, and blocked/rate-limited follow-up. The related PostgreSQL suites **41 passed**, the reviewer-site fixture production build/typecheck passed, Ruff `F,E9` and `git diff --check` passed. All three hosted PR checks passed on `a84f103`. Review/publication remain human actions; actual Railway cron settings and live paid-provider results are not yet verified.
- Second review before merge: `4e94e50` keeps the final reserved Gemini call in progress until it settles, then completes or exhausts the batch based on its result; it also avoids returning a queued entry from a terminal batch. Two PostgreSQL edge regressions were added. The focused suite **6 passed**, Ruff `F,E9` and `git diff --check` passed. A local full backend run reached **499 passed** and was interrupted while the pre-existing year-long refill simulation was still running. All three hosted PR checks passed on `41b46aa`, including the complete backend suite. Mobile card-information and owner batch controls were re-read without another actionable finding. Production Gemini calls, release deployment, and physical-phone verification remain unperformed.
- Follow-up `f7cfb81` adds a three-dot information menu to the shared mobile lesson card (Today and saved/history detail): title, topic, content version, and exact-version verified reviewer name/date. Existing visible reviewer credit remains. No backend schema change. Mobile typecheck and fixture Expo web export passed; the light/dark browser flow passed on Today and History detail, including flashcard flip, and the sheet was inspected in both themes. The full mobile Node suite recorded **96 passed, one pre-existing `publicConfig.test.mjs` stderr assertion failed** under local Node 24; this change does not touch public config. All three hosted PR checks passed on `3f4b9de`. Physical phone verification remains for release.
- After PR #357 merged into `develop`, the owner requested one further PR before release: show exact-version reviewer credit on the Today card, prepare existing published lessons as complete private Gemini drafts by subject, and keep new-card refill paused until old cards are reviewed. [Issue #368](https://github.com/Coding-Moves/one-concept/issues/368) tracks code and later live acceptance. This work does not change production variables, call Gemini, publish content, or release the app.
- [PR #369](https://github.com/Coding-Moves/one-concept/pull/369) targets `develop` and leaves issue #368 open for live acceptance. `7e82d9c` adds Today reviewer credit. `bb5e673` separates legacy and future generation switches. `b813a9c` adds a bounded, source-grounded legacy worker, owner API, private revision staging, claim fencing, and PostgreSQL regressions. `a92d085` adds owner batch controls and a browser regression. `441fd8d` gates manual future requests; `a5d8472` reports both workload switches; `77afc46` includes incomplete attested cards and blocks provider-permission failures; `90b826c` and `301d8dc` extend mobile and owner browser checks. This log update is recorded by its own documentation commit.
- Validation: full backend PostgreSQL suite **553 passed**; final legacy worker/eligibility suite **4 passed**. Website fixture production build, 11 unit tests, **44 browser tests**, and final owner-to-review browser check passed. Mobile typecheck, reviewer-attribution unit test, fixture Expo web export, and light/dark mobile-web visual flow passed. Ruff `F,E9` and `git diff --check` passed. A live paid-tier Gemini search-grounding call, real owner/reviewer approval, Netlify/Railway deployment match, and phone visibility are not yet verified. Search grounding requires a paid Gemini project; verify billing before the private smoke batch. The legacy staging gate does not create new concept IDs for learners who exhausted a subject.

### #359 final website and learner synchronization audit — PR #357 updated

- Continued open PR #357 on `codex/263-published-review-detail`. `3a5ff37` lets a successful lesson-detail reload clear a stale conflict even if the separate timeline/history request fails; the warning remains visible. `cb15420` prevents a delayed old detail response from replacing a newer corrected lesson in the mobile saved cache. `a84cdc8` adds a two-session browser regression for owner assignment, reviewer comment, owner history, publication, and reviewer visibility.
- Edge checks: reviewer-site production build with public test values, 11 unit tests, and **43 browser tests passed**. Full backend suite against disposable PostgreSQL: **548 passed**. Mobile typecheck and 7 focused saved-content sync tests passed. Full mobile Node suite: **95 passed, one pre-existing `publicConfig.test.mjs` stderr assertion failed** in this local runtime. `git diff --check` passed. Public fixtures and disposable PostgreSQL were used, not production accounts.
- Live authenticated owner/reviewer actions, real Gmail inbox receipt, AI correction, matching Netlify/Railway deployed revisions, and an eligible phone's corrected offline saved card remain production acceptance checks after release. Keep #359 open through those checks; merging into `develop` does not update production.

### #359 editorial-to-learner integration — PR #357 ready for review

- The owner and reviewer workspaces are role-based views of one Netlify site, backed by the same API and database. Production rehearsal published Blue-Green Deployment but exposed a historical revision detail failure. [Issue #359](https://github.com/Coding-Moves/one-concept/issues/359) holds the combined correctness and live-acceptance scope; [PR #357](https://github.com/Coding-Moves/one-concept/pull/357) targets `develop` without a production release.
- `189664a` restores immutable historical Lesson/Changes data after publication or retirement, lets MFA-verified approval/publication roles read their work, requires a `review`-capable assignee, and tests separate owner/reviewer/learner identities through change request, correction, approval and publication. `a0ad563` aligns the website roles, assignment choices, unsaved-change guard and browser regressions. `28aa11c` adds aligned saved-content versions to learner state; `e592d5f` refreshes only stale saved bodies, preserving offline/account-switch safety. The branch includes latest `develop` through merge `b75125d`.
- Validation: full backend PostgreSQL suite **548 passed**; website production build, 11 unit tests and **41 browser tests passed**; mobile typecheck and 11 focused saved/cache tests passed. Full mobile Node suite: **95 passed, one pre-existing `publicConfig.test.mjs` stderr assertion failed** in this local runtime. `git diff --check` passed. The latest fetched production `main` is `9551717` (v1.10.8); public Netlify sign-in/About/Privacy/callback routes load, Railway `/health` reports database reachable, and unauthenticated editorial and learner reads return 401.
- Live authenticated owner/reviewer actions, real Gmail inbox receipt, AI correction, matching Netlify/Railway deployment SHAs, and an eligible phone's corrected offline saved card remain unverified. The runbook in `EDITORIAL_ROLLOUT.md` lists the rehearsal. Keep #359 open through those checks; a `develop` merge alone will not update the live services or installed mobile app.

### #263 published revision display — initial fix in #357

- Production rehearsal published Blue-Green Deployment revision `74ff49eb` as content version 1. Its detail page then showed raw JSON and a stale-base warning because publication correctly advanced the concept beyond the revision's base version.
- `6fc79e5` excludes published and retired revisions from the stale action gate while preserving it for open review work. Further historical validation and diff fixes are tracked in #359 above.
- Validation: 22 PostgreSQL-backed editorial content API tests passed, including the new publish-then-read regression. The live page remains unchanged until this fix reaches `main` and Railway. Email delivery, AI correction and learner-device visibility for #263 remain to be verified.
- [PR #357](https://github.com/Coding-Moves/one-concept/pull/357) targets `develop`. It must be reviewed and separately released before the production page changes; no merge or production deployment occurred in this chunk.

### Review-site direct-route stability — in progress

- Release PR #366 exposed a flaky legacy-review browser test: direct navigation could race ahead of the authenticated reviewer workspace. `65746f8` waits for the ready workspace before both direct legacy-review navigations, preserving the test's stale-version coverage without changing product behavior.
- Local browser execution is blocked by missing checked-out `react-markdown` and `remark-gfm` packages; PR CI performs the authoritative clean install and browser validation.

### v1.10.8 release repair — in progress

- The v1.10.7 Release workflow completed its protected schema check and production/preview OTA publications, then correctly stopped before tag creation because tag `v1.10.7` already existed at `38489a21`. It did not dispatch the APK build. The published v1.10.7 OTAs do not reach an older 1.10.1 native runtime.
- `247abf7` prepares v1.10.8 with a new native runtime and matching one-time What’s New card. It is required because the current release contains Camera and Image Picker native configuration absent from the old v1.10.7 tag. Mobile typecheck and exact version/card verification passed.
- After this preparation PR is merged into `develop`, open a new `develop` → `main` v1.10.8 release PR, verify the deployed SHA, then run the guarded Release workflow once. Do not rerun v1.10.7.

### v1.10.7 production migration record — in progress

- The release operator confirmed production application and RLS verification for migrations `0040_profile_avatar_bio.sql` through `0043_future_refill_daily_usage.sql` on 2026-10-04. `1294459` records those verified filenames in `backend/migrations/applied.txt`; this is an operator ledger, not a substitute for the protected target-schema check.
- The focused ledger PR targets `develop`. Once merged, open the required `develop` → `main` release PR; its final diff already contains the v1.10.7 app version and matching one-time What’s New card.

### #353 conservative future-card refill — in progress

- Scope: keep future curated supply off the request path while using durable Pacific-day per-topic and global provider allowances. This is separate from #352 legacy enrichment and retains private review/publication gates.
- Implemented: `973be01` adds separate Pacific-day global and per-topic refill allowance storage and conservative settings; `ec8c476` uses those allowances only for future curated backlog work, with low-supply demand, fair normal passes and an explicit disabled-by-default urgent pass; `ebba018` exposes topic eligibility and the isolated allowance in the protected health report.
- Review follow-ups: `188a829` preserves the existing general-generation default and compatible prefetch budget handling. `fcb1ab1` makes the protected report use the worker's actual review-load decision and expose a concrete refill blocked reason; `55a47e3` clarifies that the older generic batch setting does not control the one-card-per-topic future policy. CI then found the compatibility case still limited legacy prefetch to one attempt; `c34308d` restores the old configurable batch only when the future-refill settings are absent.
- Validation: Python compilation and Ruff passed. The focused PostgreSQL suites were invoked but skipped because no local test database was running. The previous GitHub run had one remaining legacy prefetch regression; its focused fix is pending the new remote CI run.
- Migration guard: `0043_future_refill_daily_usage.sql` remains unapplied during development. `FUTURE_REFILL_ROLLOUT.md` requires applying and verifying it only during the completed release process.

### #352 legacy complete-card enrichment — in progress

- Scope: introduce a dedicated, resumable subject-at-a-time legacy enrichment pipeline. It snapshots eligible published lessons, generates private complete-card revisions, preserves old learner-facing content, and requires ordinary authenticated review and publication. It does not change future curated generation or learner progress rules.
- Planned commits: durable batch/entry storage, owner-fenced batch API and worker claims, reviewer generation console, integration coverage, and a Railway runbook with temporary-key rotation.
- Migration guard: `0042_legacy_enrichment_batches.sql` remains unapplied during development. `docs/LEGACY_ENRICHMENT_ROLLOUT.md` requires applying and recording it only in the completed release process after backup and RLS verification.

### #349 QR scanning and one-way Connect — in progress

- Scope: replace the mutual-request path with safe directed connections that start only from an opaque public profile QR/link. Preserve accepted legacy pairs as two directed rows, enforce blocks and current sharing at every operation, and add QR-only camera scanning with a paste fallback. The dedicated PR targets `develop` and closes #349.
- Implemented: `cd9e752` adds the additive directed storage and two-way backfill of accepted legacy pairs; `92a0973` adds authenticated owner-fenced relationship APIs, privacy/block enforcement and PostgreSQL coverage; `60adf23` adds the mobile Connect/Disconnect/Block controls and one-way list; `ce22365` adds the QR-only scanner and SDK 57 camera configuration. Existing invitation routes remain for compatibility while the mobile client uses the new directed APIs.
- Validation: PostgreSQL relationship/schema-contract tests passed against a disposable local database; mobile TypeScript and Expo dependency check pass. The Node suite has one pre-existing `publicConfig.test.mjs` stderr assertion failure; its remaining 89 tests pass. A fresh Android/iOS build is required because `expo-camera` is native.

### #348 private avatar and concise bio — in progress

- Scope: add an optional, account-fenced learner bio and private avatar, with built-in avatar choices, library selection and camera capture. The implementation preserves the existing `profiles.avatar_url` reference, keeps public sharing opt-in, and adds no login/onboarding requirement.
- Implemented: `589ac9e` migration/model support, `ea8f5af` authenticated bio/preset/private upload API, `54e0549` built-in avatars plus library/camera editor, `37ea4a9` short-lived private delivery links, and `402c3e3` explicit public-avatar sharing. Schema contract refresh `1a2a664` accompanies the migration. Review follow-up `4c4744b` fixes the aggregate state query and rejects oversized upload requests before buffering; `033da32` keeps an explicitly shared built-in avatar visible in the public preview. Earlier follow-up `c0b58fe` supports clearing a bio, keeps signed image URLs out of disk cache, and recovers an Android picker result after activity recreation. `PROFILE_AVATARS.md` documents production verification, the Supabase Storage dashboard setup, and the required native build.
- Validation: mobile TypeScript passes. The image-normalization smoke check confirms an image is re-encoded below 256 KiB and bio whitespace is normalized. The mobile Node suite has one pre-existing `publicConfig.test.mjs` stderr assertion failure (the child exits 1 correctly but its stderr is empty under this runtime); all other 89 tests pass. Backend integration tests could not collect because the local environment lacks the mandatory database/Supabase configuration; this feature's pure server module was validated after installing its declared Pillow dependency. The dedicated PR targets `develop` and closes #348.

### v1.10.7 release preparation — PR #354

- Scope: promote the reviewed `develop` work, including PR #351's editorial draft conflict and Markdown fixes, through the normal release process. `cfe4422` adds app version 1.10.7, a matching one-time What's New card, and a new native runtime; the production PR remains `develop` → `main`.
- Expo SDK 57 package updates from PR #350 include native Expo modules, so the next release needs a new runtime and APK rather than an OTA-only update to the installed 1.10.1 runtime. No migrations appear in the current `main` → `develop` file diff. Live draft → email → changes → publish → learner acceptance for #263 is still unverified.
- Validation: mobile TypeScript, all 90 Node tests, `npx expo install --check`, fixture-only Expo web export, and the phone/landscape What's New browser check in both themes passed. [PR #354](https://github.com/Coding-Moves/one-concept/pull/354) targets `develop`; the production release PR can open only after its merge and a final `main` diff check for both the version and card. Production merge, website deployment and mobile publication have not occurred.

### Editorial draft conflict recovery — in progress

- Second review: `e0cb52b` makes an older revision show the current published lesson before its correction can be staged, including after Reload. `e3cedfb` keeps Markdown in short headings inline, and `042e634` reports Markdown accurately in editorial detail responses. All three fixes and regressions remain in PR #351.
- Scope: preserve a manually completed correction when staging returns a stale lesson token, distinguish that case from a curriculum conflict, and make reviewer-authored Markdown display consistently on the website and in the mobile lesson/quiz experience. The live lesson remains unchanged until a draft passes review.
- Legacy corrections now start from the current concept body. Reload keeps entered fields and refreshes the staging token when that body is unchanged; if the live body changed, it requires explicit review before continuing. Curriculum conflicts display an actionable message without locking the form.
- Implementation and browser regressions: `46571f2`.
- Follow-up review found that revision editing did not refresh the current concept token after a conflict. Commit `0964474` fixes that path and adds a browser regression. `b4de9ae` adds safe website Markdown and an editor preview; `376f263` renders the same lesson and quiz writing on mobile without a native module. Identifiers, URLs, and settings remain plain inputs. Embedded Markdown images and raw HTML do not load or execute.
- Validation: admin build/typecheck, 11 Vitest tests and all 37 Playwright tests pass. The 22 backend editorial content integration tests pass against disposable local PostgreSQL. Mobile TypeScript, all 90 Node tests, `npx expo install --check`, Expo web export, and local mobile learning UI in both themes passed for the earlier mobile change. The mobile dependency audit retains the existing 17 high findings from #321; this change did not increase that count. No production deployment or live draft staging has been verified.
- [PR #351](https://github.com/Coding-Moves/one-concept/pull/351) targets `develop`; review its hosted checks before requesting PR-specific merge approval. The operator must copy their current unsaved form before opening the new site build, because that tab still runs the old JavaScript. A mobile release or OTA publication is separate from merging this PR.
### #321 dependency audit — in progress

- Scope: reproduce the bot-reported mobile dependency audit against current `develop`, apply only Expo SDK 57-compatible dependency updates, and keep the audit meaningful. The backend audit reports no vulnerable dependencies.
- Implemented `82c65b2`: updates the direct dependency set and lockfile to Expo's current SDK 57-compatible versions, including the available `brace-expansion` security patch. The dedicated PR targets `develop`.
- Remaining audit finding: npm reports 17 high findings with no compatible fix; its suggested resolutions downgrade Expo 57 to Expo 44 and React Native 0.86 to 0.72. The existing audit workflow remains unchanged so those findings stay visible rather than being suppressed.
- Validation: `npx expo install --check`, mobile TypeScript, and all 90 Node tests pass. [PR #350](https://github.com/Coding-Moves/one-concept/pull/350) targets `develop`. It addresses the safe dependency remediation but intentionally does not close #321 while the unresolved findings remain tracked.

### #346 learner UX flow — in progress

- Scope: simplify the learner profile, public-sharing and connections journeys
  without changing the existing account, privacy, offline, or version-conflict
  contracts. Independent visibility choices use accessible switches; radio
  controls remain reserved for mutually exclusive choices.
- Planned commits separate the publish-review flow, profile information
  hierarchy, connections navigation, browser regression coverage, and handoff
  documentation. The dedicated PR will target `develop` and close #346.
- Implemented commits: `0f1941e` adds the private review-before-publish sheet,
  one publish action and unpublish confirmation; `84f0038` groups Profile by
  learner task; `f9aa6a0` makes connection categories an accessible selected
  tab group and limits retry to error recovery; `603ba85` updates the mocked
  browser regression for review, publishing, conflict recovery and unpublish.
- Validation so far: mobile TypeScript and all 90 Node 24 tests pass. The Expo
  web fixture export started Metro but did not write its configured output
  directory in this environment, so the browser regression is pending a
  successful fixture export. Physical-device switch, screen-reader and sharing
  acceptance remain manual checks before release.
- [PR #347](https://github.com/Coding-Moves/one-concept/pull/347) targets
  `develop` and closes #346 when it merges. It contains no release/version,
  backend, database, deployment, or OTA change.
- Review follow-up: `a471832` replaces the platform-specific unpublish alert
  with an accessible in-app confirmation panel and corrects the browser test's
  updated Profile navigation label. TypeScript and all 90 mobile tests pass
  again after that correction.


### #340 mobile controls and visual system — ready for review

- The mobile controls now use a shared icon-led `SettingRow` and semantic
  light/dark accent pairs. Daily reminders update immediately, serialize the
  full preference document to prevent stale writes, show saving only on the
  affected row, and register a device only after the saved daily choice.
  Weekly quiz alerts stay visibly unavailable while their Daily reminders
  prerequisite is off, without erasing the learner's saved quiz preference.
- Sharing and connection choices use the same native accessible control. Both
  weekly and subtopic answer choices now show an icon marker as well as a
  color, with radio-group semantics and explicit correct/incorrect feedback.
- Commits: `56890d7` shared visual controls, `92cfa82` reminder responsiveness,
  `91bd3cf` sharing/connection controls, `3ebd6d1` quiz answer markers, and
  `93e7cb0` delayed-response browser coverage. Review follow-ups `70a0d88`
  and `38253c8` restore only confirmed state after rapid failed changes and
  cover that sequence. Review follow-ups `ef30342` and `37410f9` keep Weekly
  alerts unavailable until Daily reminders are confirmed and prevent ignored
  duplicate connection-preference taps. No backend, migration, production
  setting, release, or OTA change is included.
- Validation: mobile TypeScript and all 90 Node 24 tests passed. A fixture Expo
  web export and the mocked Profile browser regression passed in light and dark
  themes, including delayed daily/weekly saves, rollback, dependency state,
  sharing, and narrow-layout checks. Physical Android switch feedback and
  device notification permission remain a manual acceptance check.
- [PR #345](https://github.com/Coding-Moves/one-concept/pull/345) targets
  `develop`; #340 was closed after the PR was opened at the owner's request.

### #313 public review pages — v1.10.6 release preparation

- PR #341 merged into `develop` at `9783fde`; its public About and privacy pages
  are not yet on Netlify production, which deploys `main`.
- `bba1b0d` adds an About-screen link to the public explanation of lesson
  review. `1372669` prepares app version 1.10.6 and its matching one-time What's
  New card. Native runtime 1.10.1 is unchanged; this is a JavaScript/site update.
- Validation: Node 24 TypeScript and all 90 mobile unit tests passed; fixture
  Expo web export passed. The What's New browser check passed in both themes
  across phone/landscape sizes, including dismissal after offline restart.
  Profile → About showed the new link on a 390px screen with no browser errors.
  The live destination and physical-device tap are unverified until deployment.
- [Release-preparation PR #342](https://github.com/Coding-Moves/one-concept/pull/342)
  targets `develop`; all three hosted checks passed at `92bf989`. After its
  merge, verify the final `develop` → `main` diff contains both the version
  bump and card before opening the production release PR. No OAuth publishing,
  Gmail send, mobile OTA, production merge, or issue closure occurred in this
  chunk.

### #313 Google OAuth production branding — PR #341

- Google Auth Platform blocks leaving External Testing until an app name,
  support email, public homepage and privacy-policy URL are set. The current
  review site's root is a sign-in page; its SPA `/privacy` fallback is not a
  privacy policy. The separate learning-app `/privacy` page does not disclose
  the Gmail reviewer sender and is on another host.
- [PR #341](https://github.com/Coding-Moves/one-concept/pull/341) on
  `codex/313-oauth-public-pages` adds static
  `/about.html` and `/privacy.html` to the same review-site host, with an
  accurate explanation of send-only Gmail OAuth. `1c3d233` adds the pages and
  their stylesheet; the runbook records the exact future live URLs and
  the domain-verification limitation. It references #313 but cannot close it:
  publishing, a fresh token, Railway flag changes and first inbox receipt are
  still operational acceptance steps.
- Validation: Node 24 admin build/typecheck passed with public fixture config;
  built pages and links were inspected, and desktop/phone browser renders were
  checked. No live deploy or Gmail send occurred. The operator must not enter
  the URLs in Google Cloud until the pages reach the `main` Netlify deploy.

### #329 empty-topic learner experience — ready for PR

- This mobile chunk consumes the additive `daily_availability` contract from #330 only when the server explicitly returns `personalization_required`; older API deployments keep their current exhausted behavior.
- Today now explains that the learner should follow topics, offers one direct `Choose topics` action, preserves existing daily assignments, and labels cached guidance while offline. Profile makes daily and weekly reminder prerequisites clear without changing saved preferences.
- Commits: `adc03ed` maps the typed state, `f0a2503` adds the Today recovery path, and `562b123` clarifies notification settings. Browser coverage and documentation follow in separate focused commits.
- Review follow-up: `e513785` removes an undefined concept fixture from the new browser mock route, so future scenario expansion cannot fail with a reference error.
- Validation: Node 24 TypeScript and all 90 mobile tests passed. Hosted browser checks passed in light and dark themes for the no-topic prompt, topic navigation, offline cached guidance, reminder prerequisites, and large text. Native-device acceptance remains manual.

### v1.10.5 reviewer-site release preparation

- Owner merged Netlify preparation PR #331 into `develop`; profile-control PR
  #332 also merged. `main` remains v1.10.4 and lacks the static-host files.
  Netlify project `coding-moves-one-concept-review` exists but its initial
  preview said Page not found; keep it private while checking the `admin`
  build settings. A preview for this preparation PR was created; disable
  preview/branch deploys until an isolated test backend exists.
- `cbdfe0d` prepares the required v1.10.5 app version and matching one-time
  What's New card, describing the profile/share/connection improvements from
  #332. Runtime 1.10.1 stays unchanged: these are JavaScript/site changes.
- Node 24 `npm run typecheck` and all 90 mobile unit tests passed. The fixture
  Expo web export and `--whats-new` browser check passed across small/standard
  phone and landscape layouts in both themes, including offline-restart
  dismissal. `git diff --check` passed. Native device checks and the live
  Netlify site remain unverified.
- [Preparation PR #334](https://github.com/Coding-Moves/one-concept/pull/334)
  targets `develop`; hosted checks follow this push. Once merged by the owner,
  prepare the `develop` → `main` release PR. No production deployment, email
  flag, mobile OTA or PR merge occurred in this chunk.

### #330 empty-topic daily policy — PR #333 open

- [PR #333](https://github.com/Coding-Moves/one-concept/pull/333) targets `develop` and closes #330. It contains focused commits for selection, API/state, reminders, documentation, handoff, and concurrent-device coverage.
- Scope: make an intentional empty followed-topic list a stable daily-learning
  state. A new daily assignment must not silently widen to unrelated catalog
  content; an existing same-day assignment remains readable and completable.
- `428c061` adds the selection contract and PostgreSQL coverage for empty follows,
  existing assignments, and resuming after a follow. `1aa4653` exposes typed
  `personalization_required` and additive `daily_availability` API/state values.
  `645cf54` pauses topic-dependent daily push claims while retaining reminder
  preferences and registered handsets. `eb3c8ac` documents the contract and
  staged mobile rollout.
- No migration is needed: active membership already lives in `user_topics`.
  No Gemini generation is requested on this path. The weekly-quiz policy and
  existing quizzes are unchanged.
- Passed locally: PostgreSQL-backed selection, daily API and reminder regression
  suites; backend Ruff F/E9 lint; documentation/diff whitespace checks. The
  next chunk (#329) will consume this contract in Today UI after this backend PR
  is reviewed and merged.

### #328 — profile controls and connection clarity prepared

- `codex/328-profile-controls`, based on `3731fd9`, groups the requested
  learner-facing profile and connection improvements into one dedicated PR.
  Commits keep name-save confirmation, sharing-state clarity, immediate switch
  feedback, connection copy, browser regressions, and stale-read fencing
  independently reviewable.
- Server-backed notification and connection-preference switches now change
  immediately, remain explicitly busy while persisting, roll back on failure,
  and reject stale initial/reload reads. Sharing makes saved versus unsaved
  choices explicit and will not reload over an unsaved draft.
- Validation: Node 24 mobile suite **90 passed**, TypeScript passed, and the
  mocked exported-app Profile/Connections browser scenarios passed after a clean
  web export in both themes, including delayed saves, failure rollback, large
  text, sharing and connection actions. Native screen-reader and physical-device
  touch feedback remain manual acceptance checks.


### #281 / #313 reviewer website rollout — PR #331

- Owner chose the next #263 child and confirmed existing Netlify and Render accounts.
  Netlify Free is the selected static host: its `_headers` and `_redirects`
  support the review site without a paid plan, separate server or domain. The
  free plan has a hard 300-credit monthly cap; keep previews off until #255.
  Owner asked about a combined Render/Vercel service; their free worker/cron
  limits and the production Railway Docker-context change favor keeping the
  healthy API/workers there and hosting only static assets on Netlify.
- This chunk prepares production static-host configuration and a direct
  production runbook. `main` already contains the compatible v1.10.4 API/site;
  the owner reported migrations through 0039 and protected schema verification.
  It does not claim live hosting, owner bootstrap or inbox delivery.
- `6f9067e` adds Node 24 pin, Netlify SPA rewrite and build-time exact-origin
  security headers with a regression check. The separate operator-runbook and
  codebase-map commit is `680a6bb`. [PR #331](https://github.com/Coding-Moves/one-concept/pull/331)
  targets `develop` and is open for review. No PR merge,
  production flag change, paid service or real email is part of these commits.
- Admin TypeScript/build and all 11 unit tests passed with fixture public
  origins. The generated `dist/_headers` and `_redirects` were inspected;
  all 31 existing browser tests passed. An initial header-test assertion
  matched a valid `https://` URL and was corrected. Live Netlify headers,
  owner sign-in, permission denial and inbox delivery still need deployment
  acceptance; fixtures do not prove them.
- Hosted PR checks were queued/running at opening. The owner has an existing
  Netlify account but the in-app browser required GitHub two-factor sign-in;
  deployment must wait for that login and for the reviewed site config to reach
  `main`. Keep #313 and #281 open until real acceptance, and do not enable email
  with a placeholder link.

### v1.10.4 release gate repair — PR #325

- [Release PR #324](https://github.com/Coding-Moves/one-concept/pull/324)
  merged to `main` at `7f4e18e`, but v1.10.3 has not been published. The
  post-merge Migrations workflow failed because its reusable protected schema
  job received an empty `DIRECT_URL`. An independently dispatched
  [main schema check](https://github.com/Coding-Moves/one-concept/actions/runs/37104525667)
  used the protected secret and printed `{"schema_ready": true, "errors": []}`.
- `80d2986` makes the Migrations and Release schema checks direct
  `production-schema` jobs, matching the successful path; standalone manual
  verification remains. `61494fb` prepares app version 1.10.4 and its matching
  feature-focused What's New card. Native runtime remains 1.10.1, so a new APK
  is still needed for users on runtime 1.10.0.
- [PR #325](https://github.com/Coding-Moves/one-concept/pull/325) targets
  `develop`; all four hosted checks passed on `a9bbea9`. Its merge into
  `develop` and the subsequent `develop` → `main` release PR remain pending.
- Node 24 mobile typecheck and all **90 unit tests** passed. YAML structure,
  protected secret reference, and diff checks passed. A sandboxed first test run
  had one subprocess `EPERM` failure; an unsandboxed rerun passed all tests.
  The public API `/health` returned HTTP 200, but Railway marked the `7f4e18e`
  deployment failed. The available Railway CLI login has access only to the old
  project, so its exact failed service/log and the API/worker SHAs remain
  unverified. Do not publish OTA/APK until the matching healthy rollout is proven.
  No release workflow, OTA, APK, tag, flag change, or Railway retry occurred.

### v1.10.3 release preparation — PR #323

- [PR #322](https://github.com/Coding-Moves/one-concept/pull/322) merged to `develop` at `e529a57`, correcting only test-fixture trigger expectations. The production check is still red on `main` until that fix ships.
- [PR #323](https://github.com/Coding-Moves/one-concept/pull/323) prepares `expo.version` 1.10.3 and a matching nonempty one-time What's New entry; native runtime stays 1.10.1. Commit `fb4c5f4` contains the version/card pair. The prior v1.10.2 release was merged but never published.
- Node 24 mobile typecheck and **90 unit tests** passed; diff check passed. No production OTA/APK, database change, feature enablement, or merge performed here. Once #323 merges, open the `develop` → `main` release PR, verify its final diff includes both version and card, and follow the protected schema/Railway gates before publication.


### Release v1.10.2 — production schema contract follow-up

- [Release PR #317](https://github.com/Coding-Moves/one-concept/pull/317) merged at `634b6d5`. A fresh protected [schema check](https://github.com/Coding-Moves/one-concept/actions/runs/37102754269) reached production but reported only two missing `test_assign_*` triggers. Both are created by the disposable PostgreSQL fixture after migrations; production must not install them.
- [Fix PR #322](https://github.com/Coding-Moves/one-concept/pull/322) targets `develop`. Commit `007d644` removes only those fixture triggers from the reviewed contract and makes its generation test compare the exact migration-derived snapshot without test helpers. No production SQL, migration, ledger, feature flag, or mobile code changed.
- Focused schema contract/check suite: **28 passed** against disposable PostgreSQL 16; diff check passed. Release remains unpublished. After this correction reaches `main`, rerun the protected schema check, verify the matching Railway API/worker revision and health, then run the Release workflow and obtain the new runtime 1.10.1 APK.


### Release #317 version correction — PR #320

- Current production `main` is `67bdd68` from release #253, with the
  published `v1.10.1` tag and `expo.version=1.10.1`. Release PR #317
  still carried that marketing version, so its Release workflow would reject
  the existing tag. [PR #320](https://github.com/Coding-Moves/one-concept/pull/320)
  targets `develop` with `2b1d448`: bump to app v1.10.2, add the new
  feature-focused card, and restore the published 1.10.1 card. The native
  runtime stays at 1.10.1 for the new APK; production APKs use runtime 1.10.0.
- Validation: mobile TypeScript passed; 90 mobile unit tests passed; synthetic
  Expo web export and six-layout light/dark What's New browser checks passed,
  including offline-restart dismissal; diff checks passed. PR CI follows.
- Owner-pasted Railway pool-topup deployment `21364d82` uses `main` commit
  `67bdd68` and logs `generation disabled`. That source has no
  `schema_check.py`, and the pasted deployment has no `schema_ready` output.
  The owner earlier reported all three Railway pre-deploy checks passed, but
  their exact source revisions and outputs remain unverified. Do not treat
  deployment success as schema verification.
- #317 has not merged; no production OTA/APK, backend deployment, generation
  activation or email send was performed. Continue checking actual production
  schema, effective flags, release compatibility and owner approval before
  release.

### Release #317 native/card preparation — PR #319

- [PR #318](https://github.com/Coding-Moves/one-concept/pull/318) merged into
  `develop` as `7467151`; release PR #317 now passes the migration-ledger check.
  The protected actual-schema check is main-only and was skipped on the PR.
- [PR #319](https://github.com/Coding-Moves/one-concept/pull/319) targets
  `develop` with three focused commits: `83d5c5b` removes duplicate dependency
  keys without changing resolved versions; `4cf0654` replaces 1.10.1 recovery-only
  card copy with delivered learning/profile benefits; `c389385` raises the native
  runtime to 1.10.1 for the updated Expo modules. The owner chose a new APK over
  reverting the native packages. Existing 1.10.0 installs need that APK to get
  this release's mobile features; no OTA will target their old runtime.
- Verification: `npm ci` succeeded, TypeScript passed, **90 mobile unit tests**
  passed, and the synthetic web export passed the six-layout light/dark What's New
  browser check with offline-restart dismissal. Manifest and lockfile root match,
  neither JSON file has duplicate keys, and diff checks passed. An initial
  sandboxed test run had one subprocess assertion fail because stderr was empty;
  the isolated test and full suite passed outside that restriction. Screenshots
  were inspected at narrow dark and landscape light sizes.
- No release merge, production OTA/APK publication, backend deploy or native
  device acceptance has occurred. Release #317 remains subject to final CI,
  actual-schema/deployment checks and explicit owner merge approval.

### Production migration ledger for release #317 — PR #318

- The owner reports successful production SQL Editor execution through
  migration `0039`. For the uncertain `0023`/`0024` pair, both `0023`
  tables existed, the completed-assignment backfill gap query returned zero,
  and `0024` reported Success before `0025` onward was run.
- `e1d35a5` records all 23 filenames in `backend/migrations/applied.txt` without
  editing or rerunning SQL. [PR #318](https://github.com/Coding-Moves/one-concept/pull/318)
  targets `develop`; after its owner-approved merge, release PR #317 will
  inherit the ledger. This entry's commit is identified by its subject.
- Local verification: all 39 SQL filenames exactly match the 39 ledger entries;
  no missing or extra names; `git diff --check` passed. The production database
  was not independently queried by this branch. The protected actual-schema
  check, release-head CI, native-runtime decision, and remaining PR #317 release
  gates still require verification. Neither PR was merged and no deployment or
  mobile publication occurred.

### PR #316 — second code review complete

- Reviewed reporting authority, aggregation, privacy, telemetry, filters, demo
  and responsive browser flows against #297; fixes remain in the same PR.
- `59771e1`: accept compact public incident IDs as well as hyphenated UUIDs.
  The browser regression failed on the original validation, then passed; the
  real API regression also verifies compact IDs locate the correct event.
- `999d54c`: retain worker observations independently of the API telemetry flag.
  The PostgreSQL regression reproduced the incorrect unavailable status before
  the fix. Switches/cap are now explicitly labeled as API configuration because
  separately deployed workers can have different values.
- `beeea58`: hide the dashboard queue shortcut without review permission while
  retaining reporting/account management. `e0fe2dd` aligns synthetic UUID filters
  with the real API. `78e57e1` prevents narrow status values wrapping into broken
  words; inspected the corrected phone-width dark operations view.
- Passed: **522 backend tests, no skips**, on disposable PostgreSQL 16; **31
  browser tests**, plus both-theme reruns after the final scoped CSS fix; **10
  admin unit tests**, TypeScript/production build, F/E9 lint, documentation links
  and diff checks. An initial build lacked public configuration; reran with
  explicit synthetic settings successfully. Existing ~519 kB bundle warning remains.
- No remaining actionable blocker found in this review. Hosted checks follow
  this push. No merge, production SQL, deployment or flag change; no manual setup
  is required before merge into develop. Activation remains under #281.

### #297 — owner dashboard implementation complete

- Scope is implementation only in the existing `admin/` application. Both
  reviewer and owner sections deploy under #281 after the normal production
  release. No staging creation, production migration, live flag change, version
  bump, deployment or merge was performed.
- [PR #316](https://github.com/Coding-Moves/one-concept/pull/316) targets
  `develop`; base `31300ce`, branch `codex/297-owner-dashboard`. `8b1460b` adds private
  reporting endpoints, migration 0039 and schema contract. `768c5b4` adds opt-in
  bounded worker/API observations. `ffaf68d` adds the four report pages, isolated
  demo, responsive themes and browser coverage. `adec7e9` isolates report fixtures
  from the default topic list used by later learner tests.
- Access reuses explicit `manage_reviewers`, approved identity, live session and
  MFA. Report data is memory-only; date windows, paging and SQL timeouts are
  bounded. Names come from immutable review evidence; delayed publications keep
  attribution even after account deletion. Missing/stale signals are explicit.
- Passed: admin TypeScript/build and 10 unit tests; all 29 browser tests, plus
  a focused two-test rerun for OAuth-fragment demo isolation and real invitation
  callbacks. Visually inspected light desktop and dark narrow screenshots.
  Vite reports a non-blocking bundle-size warning (about 518 kB before gzip).
- Final full backend suite: **521 passed, no skips**, including the schema
  contract on disposable PostgreSQL 16. Initial fixture-only failures (short
  evidence note and active test topics affecting bootstrap tests) were corrected.
  Backend F/E9 lint, documentation links and diff checks passed. Hosted checks
  follow the final documentation push; the PR remains unmerged for owner action.
- [owner-dashboard.md](owner-dashboard.md) defines metrics, exclusions,
  permissions, retention, missing infrastructure signals and manual activation
  deferred to #281. No owner action is required before merging into develop.

### PR #314 — code review fixes complete

- Reviewed head `0e762b6` against #280, including SQL snapshot/version matching,
  public-field projection, mapping, caches and detail-only UI. Used an isolated
  checkout because the main workspace belongs to another task.
- `5f24e6a` fixes cached text/reviewer credit surviving authoritative 403/404/410
  responses. Detail load/refresh now removes the entry and shows unavailable;
  bundled demo fallback cannot hide removal. Offline/503 reading remains usable.
- The exported-app regression failed on the old implementation, then passed in
  both themes. Covers removal on refresh/reopen, bundled slug, cache eviction,
  transient failures and existing attribution/offline/account cases. Inspected
  the dark detail screenshot: long credit wraps below the card with no border.
- Node 24: **88 passed, no skips**; TypeScript, web export and diff check passed.
  Initial sandbox-only run blocked the validator subprocess; unsandboxed rerun
  passed. Backend unchanged; previous full CI: **502 passed**, no skips. New
  hosted CI follows this push. No production or merge action was performed.
- This documentation commit records the reviewed behavior and test coverage.
  No owner setup is required; native screen-reader/device font-scaling checks
  remain unverified. Credit stays only in History/Saved detail screens.

### #280 — exact-version learner attribution implemented

- [PR #314](https://github.com/Coding-Moves/one-concept/pull/314) targets
  `develop`. Owner requested the complete dedicated PR. Branch
  `codex/280-reviewed-attribution` starts at merged #312 (`3d361d8`).
- `fca5754`: nullable public reviewer name/date/version on full detail, daily,
  folded state and review responses; content/evidence selected in one SQL
  snapshot. Full PostgreSQL suite: **502 passed, no skips**; F/E9 lint passed.
- `5b89a4d`: shared mobile mapping, strict version checks, full cache pair
  replacement and account-change rejection. Node 24 suite: **87 passed**;
  TypeScript passed. Old payloads/caches show no invented attribution.
- `9b33935`: borderless accessible credit outside card flip faces. Both-theme
  exported-app browser checks passed for legacy/attested/new versions, long
  names, Today, History/Saved, recall, offline reload, corrupt cache and sign-out.
  Inspected light Today and dark recall screenshots after animation settled.
- This documentation commit records contract, tests, offline limits and rollout.
  Exact Expo SDK 57 docs were read. No native dependency, schema migration,
  app/runtime version bump, production action or issue closure. Deploy compatible
  backend first, then mobile JavaScript through the normal release procedure.
- Owner then requested detail-only credit. This follow-up restores the shared
  card to its base presentation and renders credit below the card only in
  History/Saved details. Updated both-theme browser scenarios and TypeScript
  pass; inspected the final light detail screenshot. Initial PR CI was all green;
  final-placement CI follows this push.
- Native screen-reader/font-scaling QA is not claimed by browser checks. #313
  hosting/email activation is independent. No manual configuration is required to merge.
- Existing unrelated demo and previous email handoff log edits remain unstaged.

### #287 — production email confirmation redirect prepared

- `codex/287-confirmation-redirect`, based on current `develop` (`3d361d8`),
  fixes the sign-up redirect without a schema or native change. The mobile app
  passes the configured API landing page to Supabase for confirmation and
  recovery, refusing malformed public URL values. The existing public
  `/confirmed` page now has a regression test.
- The required owner configuration is documented in
  [AUTH_REDIRECTS.md](AUTH_REDIRECTS.md): prove the active Railway API domain
  serves `/confirmed`, set the Supabase Site URL/fallback and exact allowlist,
  then verify the EAS production public API value. Dashboard configuration can
  occur before merge; preview test follows the `develop` merge; production OTA
  waits for a normal release PR and manual Release workflow.
- No Railway, Supabase, EAS, email template, production account, migration,
  deployment, merge, or issue closure has been performed by this PR. A fresh
  controlled-account confirmation and recovery test remains mandatory before a
  production release is claimed complete.


### PR #312 — direct production email rollout

- Owner explicitly declined staging creation/testing and requested the complete
  email implementation in the same PR. No staging attestation is required.
- `5632356` removes the staging-only production gate and obsolete settings/UI
  status. Production still requires explicit editorial/email enable switches,
  valid sender configuration, exact HTTPS dashboard origin and current reviewer
  eligibility. Existing `EDITORIAL_EMAIL_STAGING_VERIFIED=false` is ignored.
- The new production regression failed against the old gate, then passed after
  the change. Final focused PostgreSQL/provider/API/template suite: **17 passed,
  no skips**. Admin typecheck and **8 unit tests** passed; F/E9 lint and diff
  checks passed. Final full CI follows this push; prior head had all three gates
  green, including 496 backend tests and 23 browser scenarios.
- This documentation commit replaces mandatory staging instructions with the
  direct production runbook. HTML/text templates, caps, retries and 48/24/2
  policy remain implemented. No schema or migration ledger changes were needed.
- Owner reports fresh Gmail credentials stored on API and reminders with sending
  disabled; live settings were not independently inspected. Remaining activation
  inputs: durable Google OAuth authorization (Testing tokens expire in seven
  days), deployed reviewer HTTPS origin/account setup, ordered migration 0038,
  and matching production API/worker release before enabling email. Website URL
  requested; no response yet. No actual email delivery is claimed.
- No merge, live send, paid service, staging infrastructure or production setting
  change was performed. Preserve unrelated local demo work-log edits unstaged.

### PR #312 — follow-up review fixes validated

- Reviewed SQL/outbox lifecycle, provider delivery, authorization, owner controls,
  tests and deployment documentation in the same PR. Initial head `8556ea7`
  passed all three GitHub quality gates.
- `e76a485` fixes a reproduced batching bug: an old initial notice could suppress
  a newly created reminder before its collection window. Select the newest
  pending ordinal first and suppress only older events in that same cycle.
- `edbc139` adds a branded, responsive HTML email with a plain-text fallback.
  Escape content and permit action buttons only for exact workspace revision
  URLs; no external assets or tracking. Existing Supabase Auth templates remain
  unchanged. The backend image already copies the template with `app/`.
- Final focused PostgreSQL/provider/API/template suite: **17 passed, no skips**.
  F/E9 lint and diff checks passed. Rendered and inspected the two-lesson email
  at desktop and 390px phone widths; no horizontal overflow. Gmail client/inbox
  rendering remains part of real staging acceptance, not claimed by local tests.
- This documentation commit records the activation order and template paths.
  Final-head hosted CI follows the push. Merge readiness is for disabled sending;
  OAuth authorization, isolated staging inbox/login/MFA acceptance and production
  activation after the release remain manual. No production migration, live email,
  secret/configuration change, merge or issue closure performed. Prior unrelated
  local demo work-log edits remain unstaged.

### #279 — reviewer notifications: PR #312 open for review

- [PR #312](https://github.com/Coding-Moves/one-concept/pull/312) targets
  `develop` from `codex/279-reviewer-notifications`, based on `bf95496`.
  Scope: durable assigned-review emails, 48-hour deadlines, 24-hour reminders
  (maximum two), reviewer timezone and owner delivery controls. References #279;
  no automatic closure while real staging acceptance is pending. #263 remains open.
- `05f4035`: private migration 0038/outbox and corrected-draft assignment.
  `7c09a16`: Gmail HTTPS worker, bounded retries/caps and delivery tests.
  `b5624b3`: authenticated owner controls/timezone APIs. `ae72ba4`: correct the
  browser fixture's concept-action response. `47b7a74`: dashboard and browser
  coverage. `d0ff557`: free sender/OAuth setup, rollout guide and codebase map.
  This entry's commit is `docs: record reviewer notification PR handoff`.
- Verification: full disposable PostgreSQL 16 suite **491 passed, no skips**;
  final notification/API suite **14 passed** after additional batching/crash
  cases and final changes. F/E9 lint and diff checks passed. Node 24.19 TypeScript,
  **8 unit tests**, **23 browser scenarios**, fixture production build passed;
  both notification browser cases passed again after final display changes.
  Light desktop/dark narrow layouts inspected; no horizontal overflow.
- Provider decision: existing Gmail via HTTPS OAuth; Railway Free/Trial/Hobby
  block SMTP. No paid sender/domain/hosting upgrade. Owner reports Gmail API
  enabled; consent/client authorization and staging mailbox/link acceptance are
  still manual. Supabase Auth templates stay unchanged. Use
  [editorial-notifications.md](editorial-notifications.md) for exact steps.
- Sending defaults off. No live email, secrets changes, production migration,
  deployment, mobile release or merge performed. `applied.txt` remains unchanged.
  Production activation remains #281. GitHub CI is pending at handoff; local
  checks are the evidence above. Prior local-demo work-log edits remain unstaged
  and are not included in this PR.

### PR #311 follow-up review — fixes validated

- Reviewed head `3541cca` across backend contracts, authentication, decisions,
  corrections, shared reviewer concurrency, GUI/HCI and deployment boundaries.
- `8a8d17d`: render the Supabase SDK's QR data URI directly; wait for existing
  authenticators before permitting enrollment. `e5e4e05`: block approval/legacy
  attestation during manual edits, freeze pending draft edits, and offer submit
  only for drafts, matching the backend's immutable correction workflow.
- `44d16ab`: success notices identify the actual action instead of inferring a
  new publication from existing status. `697ed85`: reload correction jobs even
  when their source revision token is unchanged; surface refresh errors.
- `4a1788e`: preserve feedback through transient account-check outages and keep
  keyboard focus during queue refreshes. Subsequent 403 revocation still clears
  private content; expiry retains the sign-in explanation. `01826c1` updates
  the owner-workflow assertion for its action-specific confirmation.
- Seven regression scenarios reproduced failures before fixes and now pass.
  Local browser suite: 20 passed initially; the remaining owner-flow assertion
  expected obsolete wording and passed after correction. All 21 scenarios are
  verified. Node 24 TypeScript/build and 8 unit tests passed. Full disposable
  PostgreSQL 16 backend suite: **478 passed, no skips** (301 seconds); F/E9 lint
  passed. Light desktop queue, dark desktop lesson and narrow dark layout were
  visually inspected; responsive/keyboard checks passed.
- README clarifies public source versus invitation-only, authenticated workspace
  access. Documentation links and whitespace checked. No repository visibility,
  production flags, live accounts, migration ledger, infrastructure or merge
  changed. Hosting/real Auth emails/different-device acceptance remain #281.
- All corrections remain in [PR #311](https://github.com/Coding-Moves/one-concept/pull/311).
  Hosted final-head checks follow the push; no self-approval or merge performed.
  Handoff log commit: `docs: record reviewer workspace review and privacy boundary`.

### #278 One Concept Review website — PR #311

- [PR #311](https://github.com/Coding-Moves/one-concept/pull/311), targeting
  `develop`, closes only #278. `codex/278-review-workspace` starts at `411c9af`, after #310
  merged; step 5/9 of #263. Deliver only #278, with #279 next.
- `3246bd9`: shared queue totals, taxonomy/subtopic/deadline filters, exact-version
  published view, owner-audited deadlines and forward migration 0037.
  `68f6312`: independent static web/auth foundation. `1d15cb8`: reviewer comments
  on existing lessons and concept-scoped correction-job queries.
- `adbc898`: complete review/diff/history/checklist, approved/published/legacy
  queues, safe manual and AI corrections, owner assignment/account/invitation
  controls, profile/MFA gates, light/dark responsive UI. One reviewer approval
  is shared; another reviewer cannot approve the same revision again.
  `e5e7ffb`: fixture browser coverage and a separate website CI job.
- Local validation: full disposable PostgreSQL 16 backend suite **478 passed,
  no skips** (207 seconds), backend F/E9 lint; web TypeScript/build, **8 unit
  tests**, **14 browser tests** passed. Browser cases include shared approval,
  conflicts, lost-response identical retries, expiry/revocation, MFA/onboarding,
  invitation password setup, topic filters, owner controls and safe text/links.
- Visually inspected desktop light queue, dark complete lesson and narrow dark
  review; no horizontal overflow. Build with a forbidden fixture secret key
  failed before emission; sentinel absent from static output. Local documentation
  links and whitespace checks passed. Node 24 used; no mobile code changed.
- Initial browser attempt preceded browser installation; first installed-browser
  run exposed exact-label lookup failures and a test expiry race. Explicit form
  labels and synchronized assertions fixed them; all cases passed afterward; a final malformed-draft regression also passed.
  Initial backend fixture failures were corrected before the full passing run.
- `admin/README.md` documents staging migration 0037 after 0036, compatible API/
  worker, public web config, HTTPS callback/CORS/headers, owner bootstrap and
  different-account live acceptance. Real hosting/email/device verification is
  deferred to #281; deadline email delivery #279 and owner analytics #297 remain
  outside this chunk. Production migration ledger and infrastructure untouched.
- Hosted [quality run 36999497828](https://github.com/Coding-Moves/one-concept/actions/runs/36999497828)
  passed backend, mobile and review-website jobs at `9761422`. Final review added
  a null/malformed draft heading guard and preserved the concept’s approved
  taxonomy when repairing it; the expanded 14-case browser suite passed locally.
  Latest-head CI is recorded in the PR checks. Ready for owner review after those
  checks pass; live staging acceptance is still #281.
- Final handoff documentation: `docs: record reviewer website PR and validation`.
  No production flags, real invitations, paid requests, deployment or merge.

### PR #310 follow-up code review — fixed and validated

- Reviewed `6402cf7`: asynchronous cancellation/concurrency, exact revision
  evidence, private prompt handling, status APIs and rollout.
- `dfc885e`: reproduced P2 cancellation freeing a provider slot while the HTTP
  request remained in flight. Retain the fenced lease until completion/expiry;
  discard cancelled output and never retry abandoned cancelled work. Add forward
  migration 0036 and reviewed schema contract without changing applied history.
- `d28d1ac`: reproduced P2 configured secrets surviving JSON escaping in feedback
  and nested lesson content. Redact raw prompt strings, including title/taxonomy,
  before serialization while retaining immutable original evidence.
- PostgreSQL 16 migration/job suite: **40 passed, no skips**. Four prompt tests
  passed; quotes, backslashes and newlines failed before the correction. Full
  local backend suite: **474 passed, no skips** (209 seconds). Hosted run
  [36992838352](https://github.com/Coding-Moves/one-concept/actions/runs/36992838352)
  passed on `962b0c5`: **474 backend tests**, lint, mobile typecheck and mobile
  tests. Documentation file links and whitespace checks passed. Initial
  root-directory pytest attempts failed
  collection; the reported tests ran from backend with test-only configuration.
- Updated staging instructions: 0035 then 0036 after 0034, compatible worker/API
  images; no immediate production action needed to merge into develop. No
  production changes, live provider calls, release or merge performed.
- Review corrections and documentation are pushed to the same PR; no remaining
  actionable blocker found. Final documentation-only handoff commit:
  `docs: record PR 310 review validation`. Latest-head CI is recorded in the PR.

### #277 bounded draft replenishment and AI revisions — PR #310

- [PR #310](https://github.com/Coding-Moves/one-concept/pull/310) is step 4/9
  of #263, based on merged #309 (`5de7acf`), from
  `codex/277-editorial-generation` into `develop`; closes only #277.
  Open and ready for review; no merge performed.
- `f66b991`: private durable job schema/immutable evidence and fenced backlog
  claims. `ff86bfd`: shared human review capacity, active supply and concurrency.
  `cefe332`: authenticated exact-source revision requests, safe status/cancel APIs,
  three-attempt retry handling, current-authority checks and immutable new drafts.
  `8178bda`: explicit draft retirement frees capacity without removing evidence.
  `a9a1dd8`: existing scheduled worker integration and aggregate job monitoring.
  `e810951` fixes eligibility/reporting found in the final code review.
  `077c3be` documents API/worker contracts and staged activation.
- Original bodies, feedback and decisions remain linked; no approval is inherited.
  New/manual revisions, cancellation, retirement, revocation and reclaimed tokens
  fence late provider results. Quota and disabled generation never auto-publish.
  No new scheduler/provider; dashboard/email/production activation remain later
  #263 steps. See [editorial-generation.md](editorial-generation.md).
- Local PostgreSQL 16: **16 schema checks**, **34 focused tests**, then the full
  backend suite **466 passed, no skips** (360 seconds). After the final two small
  eligibility/reporting fixes, **39 focused regressions passed, no skips** (40
  seconds). All provider calls were mocked. Backend F/E9 lint, documentation
  local links and diff whitespace checks passed. Hosted exact-head results will
  be recorded in the PR handoff.
- Initial schema invocation used the wrong directory and failed collection; it
  was rerun correctly. Early focused runs exposed one stale-claim fixture that
  selected a different title and whitespace normalization of the saved AI source.
  The fixture now reclaims the intended title and jobs preserve the exact body;
  final tests above pass. No hidden/skipped database validation.
- No immediate manual production work. Staging needs migration 0035 after 0034,
  compatible API/worker images, shared capacity settings and identity/MFA setup.
  Production activation remains #281; the applied ledger was not changed. No
  production SQL, paid purchase, live Gemini call, release or merge performed.

### PR #309 follow-up code review — fixed and validated

- Reviewed `e6440f0` in [PR #309](https://github.com/Coding-Moves/one-concept/pull/309)
  against #276: request/permission boundaries, exact revision/state locks,
  idempotency, private evidence, operator paths, inventory and learner eligibility.
- `13ff516` fixes two P2 demand defects: retired subtopic inventory inflated the
  worker target, and the response/receipt/audit could report a smaller target
  than the upsert retained. Count active inventory and return the actual saved
  target. Four regression combinations include pre-existing demand and replay.
- `f0b5aca` fixes a P2 publication gap: published prerequisites under retired
  topics/subtopics were treated as available. Shared preflight/final validation
  now rejects both cases, with atomic rollback of approval/receipt verified.
- Baseline regressions reproduced wrong targets (3 instead of 2; reported 2/3
  when 10 was saved) and two HTTP 200 publications that should have been denied.
  The initial parameterized supply fixture reused a title/objective and hit
  import deduplication; unique fixtures now exercise the intended behavior.
- `1a7ea86` cleans up the new prerequisite fixture's active topic so the shared
  disposable catalog does not affect later generation/selection tests. Those
  four prerequisite/isolation checks passed together after cleanup. The first
  broad run exposed those two fixture interactions and ended before its summary;
  it is not counted as a completed validation.
- **32 focused PostgreSQL tests passed, no skips** after fixes. The final full
  PostgreSQL 16 suite passed **438 tests, no skips**, in 167 seconds. Exact-head
  hosted CI and the review handoff are recorded in PR #309. Backend F/E9 lint, changed
  documentation links and diff whitespace checks passed.
- No additional migration/manual production task, release, live provider call,
  account invitation or PR merge. Existing staged activation remains #281.
  Documentation commit: "Document PR 309 review findings and regression results".

### #276 editorial review and publication APIs — PR #309 implemented and validated

- [PR #309](https://github.com/Coding-Moves/one-concept/pull/309) targets `develop`
  from `codex/276-editorial-review-api`, step 3/9 of #263; closes only
  #276. Based on merged #299, then updated to `develop` at `77d175d` via `b71f865`
  to preserve the newly merged dependency updates and all focused commits.
- `c603396`: migration 0034/private workflow audit and receipts/schema contract.
  `352670a`: versioned commands and private queues/package/diff/history/validation.
  `1364e9a`: protected HTTP routes and integration tests. `8f51b8a`: authenticated
  operator CLI. `56ca4c6`: rewrite-worker compatibility with open reviews and the
  complete package. `9c95adc`: retain publisher notes and validate legacy attestation.
- Covers comments, assignments, exact-version decisions, atomic approval/publication,
  stale/concurrent/replayed commands, legacy attestation, retirement preserving
  progress, and bounded audited generation demand. No provider call in review HTTP.
  Website remains #278 and generation/revision orchestration remains #277.
- Local full PostgreSQL 16 suite: **432 passed, no skips** (169 seconds). Earlier
  44 HTTP/publication checks and eight CLI/worker checks passed. The first full
  database run had 431 passes and one new fixture search failure after changing
  its title; the final run uses its stable topic filter. A sandbox-only attempt
  could not start Podman and was stopped rather than reporting skipped DB tests
  as validation. All successful DB runs used disposable local data, no providers.
- After installing the current repository pins (SQLAlchemy 2.1.1, Uvicorn 0.54.0,
  PyJWT 2.15.1), a second full local PostgreSQL run passed **432 tests, no skips**
  in 167 seconds. Backend F/E9 lint, documentation links and whitespace checks
  passed. Exact-head hosted CI/handoff is recorded in PR #309.
- [editorial-api.md](editorial-api.md) describes permissions, endpoints, retry
  contracts, private text handling, publication entry-point audit and rollout.
  Documentation commits: `631ae7d` and "Record PR 309 validation and handoff".
- No immediate manual production task. Staging needs migration 0034 after 0033;
  production activation remains #281 with identity/MFA, compatible workers and
  device rehearsal. No production SQL, applied-ledger edit, account invitation,
  content publication, paid service, mobile/native build or PR merge performed.

### PR #299 follow-up code review — fixed and validated

- Reviewed `82c80b1` against #275, including authenticated decisions, immutable
  evidence, cutover, CLI bypass prevention and learner visibility. Three failing
  PostgreSQL cases reproduced two P2 regressions before fixes.
- `29ec677` preserves today's assignment/review slot when its lesson is hidden,
  prevents a second activity and safely handles retirement before the payload
  read. `f9eb91a` keeps earned counts/streaks independent of visible history and
  uses visible counts for pagination (including an entirely hidden history).
- **31 focused tests passed.** The first full review run had **403 passes and
  one failure**: an old like-count test assumed no earlier likes on a shared seed
  that API tests select randomly. `4765b57` checks the exact increment and own-like
  exclusion without that assumption. The final full PostgreSQL 16 rerun passed
  **404 tests, no skips**, including all four new regression cases.
- Backend F/E9 lint, changed documentation links and whitespace checks passed.
  Final exact-head hosted checks and review summary are recorded in PR #299.
  The documentation commit is "Document PR 299 review fixes and validation".
- No additional migration, environment setting or manual task for these fixes;
  the staged editorial activation prerequisites remain unchanged. No merge or
  production change. Preserve all original and follow-up commits.

### #275 exact-revision approval and provenance — implemented and validated

- [PR #299](https://github.com/Coding-Moves/one-concept/pull/299) targets `develop`
  from `codex/275-editorial-provenance` at base `db34afc`, after #298 merged. Closes
  only #275, step 2 of #263; HTTP entry points and the website remain #276/#278.
- `690f699` adds immutable evidence, explicit legacy-version cutover inventory
  and the schema contract. `c4c66b1` adds authenticated transitions, exact approval,
  version-safe publication and unchanged legacy attestation; free-text CLI
  publish/reject now fail closed. `4c76ecc` adds published-only collection/state
  and existing-assignment/review guards, with pagination filtering before limits.
- Follow-up "Verify editorial cutover and retain immutable regression evidence"
  tests real pre-0033 catalog/progress preservation and CLI bypass denial, and
  retires the yearly simulation's catalog instead of deleting its audit evidence.
- Validation: final full PostgreSQL 16 backend suite **400 passed, no skips**;
  backend F/E9 lint, local documentation links and whitespace checks passed.
  Earlier 23 focused cases passed. The first broad run had 396 passes and one
  obsolete simulation-cleanup failure; the final run includes its corrected
  cleanup plus the real cutover and CLI tests. No live provider calls occurred.
- Review checked lock order/session recheck, immutable source/body/name snapshots,
  checklist validation, stale/retired states, simultaneous approvals, idempotent
  publication, unchanged legacy attestation, private storage and learner reads.
- [editorial-provenance.md](editorial-provenance.md) documents the service contract,
  state machine, transaction requirements and staging/rollout procedure. No
  production SQL, ledger update, mobile/native release or content publication.
- Handoff: final exact-head CI is recorded in PR #299; preserve the focused
  commits and merge only with owner approval. No immediate manual action:
  0033 application and authenticated entry-point activation belong to the later
  coordinated rollout. The old publication CLI is intentionally unavailable;
  do not treat this intermediate backend as a complete production review UI.

### PR #298 review fixes — implemented and validated

- Owner requested both reproduced findings fixed in the same PR. The original
  review at `b8807a9` demonstrated an expired session still saving a queued
  profile and a nonmember occupying the shared advisory-lock queue.
- `8ab74c0` checks session deadlines against the post-wait statement timestamp;
  its regression lets a pre-existing deadline expire naturally during contention
  and verifies HTTP 401, unchanged profile/version and no profile audit write.
- `c89877e` checks current session, membership and required capability/name/MFA
  before taking the lock, then repeats all checks afterward. Nine denial cases
  finish while another transaction still holds the lock; queued revocation and
  capability-removal cases remain denied. No preliminary authority is reused.
- Validation: **38 focused tests passed**, then **378 backend tests passed, no
  skips**, against disposable PostgreSQL 16. Full backend F/E9 lint, local
  documentation links and `git diff --check` passed. No live providers were used.
- Runbook and codebase map document pre/post-lock authorization and the READ
  COMMITTED requirement. These corrections add no migration, configuration or
  manual setup step. Authorized writes still serialize across invitation HTTP.
- Handoff: preserve all focused commits in [PR #298](https://github.com/Coding-Moves/one-concept/pull/298).
  The final pushed revision's hosted CI result is recorded on the PR; this log's
  commit is "Document editorial authorization review fixes". No merge or
  production activation; existing #274 staging prerequisites remain unchanged.

### #274 reviewer identity foundation — implemented and locally validated

- First child of #263, on `codex/274-editorial-reviewer-accounts`, based on
  `develop` after #296 merged. Scope: private memberships/audit, verified-session
  authorization, invitations, profile onboarding/name approval, owner controls,
  tests and an activation runbook. Frontend screens remain in #278.
- Commits: `0b19127` private storage/session contract; `aee2804` authorization and
  owner bootstrap; `a481af9` invitation/profile/access APIs; `02dc854` origin and
  bootstrap safeguards; `faf265d` secret-safe settings errors. The documentation
  commit is identified by its subject, "Document editorial account activation and
  frontend handoff". Preserve all individual commits.
- Incorporate Faizan's multi-reviewer/profile flow using individual Supabase
  invitations and user-set passwords. Three is an initial team target, not a cap.
- No live invitations, production schema/configuration or mobile release changes.
- Verification: **367 backend tests passed, no skips**, using disposable PG16;
  **63** focused security/schema tests passed before that run; the final settings
  error-redaction change passed all **21** provider/configuration tests. Backend
  F/E9 lint, local documentation links and whitespace checks passed. A profile
  validator name collision initially blocked collection and was fixed before
  these passing runs. No new dependency or frontend/native change was introduced.
- Reusable authority checks verified JWT/session ownership, confirmed/unbanned
  Auth user, live membership, approved name and independent capabilities with
  MFA. Versioned writes recheck authority under the account lock. Tests include
  queued writes versus revocation, team growth, duplicate invitations, provider
  timeouts, stale name approvals, private storage and final-admin protection.
- [editorial-accounts.md](editorial-accounts.md) records API contracts, bootstrap,
  recovery, MFA, Auth sender/redirect setup, migration and rollback. Live mailbox
  and browser acceptance await #278/#281. Keep `EDITORIAL_ENABLED=false` until
  staging activation; #275/#276 still own exact-content provenance and publication.
- Handoff: [PR #298](https://github.com/Coding-Moves/one-concept/pull/298) targets
  `develop` and closes only #274 when merged. Hosted CI is checked on the final
  pushed revision and reported on the PR. No merge/closure or production
  activation is authorized by this implementation task.


### #268 weekly quiz notifications — owner-requested review fixes completed

- Review scope: current PR diff, delivery boundaries, mobile account safety and
  CI. Add focused regression/fix commits for candidate-queue starvation and
  malformed provider ticket isolation; preserve all existing commits.
- Both defects reproduced before the fixes (six failing regression cases).
  `12f033e` pages the complete due cohort; its 28 weekly regression tests passed.
  `f3dae3e` isolates malformed success IDs as unknown while valid
  peers retain their accepted receipts. Existing mobile code required no changes.
- Post-fix local validation: **51 passed, no skips** across weekly delivery, daily
  reminders, notification preferences and quiz lifecycle; F/E9 lint and whitespace
  checks passed. This includes **36 weekly notification cases**. Initial PR CI was
  green; final-revision hosted checks are reported on the PR. Physical staging
  delivery/tap verification and migration 0031 remain activation prerequisites.
- [PR #296](https://github.com/Coding-Moves/one-concept/pull/296) targets `develop`
  from `codex/268-weekly-quiz-notifications` (base `df67cae`), with `Closes #268`.
  Independent weekly opt-in respects the master switch, saved timezone, current
  quiz and completion. No production rollout, user-data change or release is part
  of this task; migration 0031 remains unapplied in the production ledger.
- `1d945d0` stores preferences/outbox and preserves old-client updates;
  `405e7a8` adds local 09:00 selection, durable claims, per-device tickets/receipts,
  bounded definite-failure retries and concurrency/failure regression tests.
  `fdf048a` adds settings/browser coverage; `6055d08` adds authenticated
  notification-tap routing and stale quiz-response protection.
- Worker uses the existing reminders cron after daily reminders, behind default-off
  `WEEKLY_QUIZ_NOTIFICATIONS_ENABLED`. Ambiguous outcomes/crash claims are never
  replayed; Expo cannot guarantee exactly-once handset display. Frozen quiz identity
  retains the shared ISO week, independent of local delivery time.
- Passed: full disposable PostgreSQL 16 suite **307 tests, no skips**, including
  schema contract, daily reminders and 27 weekly-notification cases; F/E9 lint;
  mobile TypeScript and **83 Node 24 tests**; final web export. Mocked browser
  settings checks passed at 320px in both themes, covering failures, weekly opt-in,
  retained preference under the master switch, and existing profile regression.
- Earlier targeted failures were test isolation issues (persistent test users and
  unscoped outbox assertions); owner-scoped assertions and isolated device fixtures
  resolved them. The full suite passed afterward. A final export permission review
  timed out; the permitted single retry succeeded. The mobile-control commit
  approval also timed out and succeeded on its single retry.
- Exact Expo SDK 57 response APIs and official push receipt/error docs informed the
  implementation. No new native dependency, secret, service or runtime change.
  `docs/weekly-quiz-notifications.md` records behavior, delivery limits, aggregate
  verification SQL, staging acceptance and the production activation/rollback order.
- Remaining before production activation: ordered migration application, reviewed
  API/worker/mobile release, physical staging-phone cold/warm tap and delivery tests,
  then owner enables the flag on the existing reminders service. Local mocks do not
  establish native delivery. No manual action is needed to review this feature PR.
- `1d82de9` records the rollout guide and codebase map. Final handoff commit
  `docs: record weekly notification PR handoff` records this PR link. GitHub CI
  status is reported separately on the PR; no merge or production activation occurred.


### PRs #293 / #295 owner-requested merge-readiness review — completed locally

- Reviewed current profile and Connections diffs, auth/ownership, public allowlist,
  revocation, migrations, mobile account/foreground boundaries, consent races,
  dependency order and hosted CI. No remaining blocker found in #293 at `3229a6f`.
- Reproduced stale invitation reuse in #295, then fixed it in `ecd33b9`: renewed
  requests receive a new action ID and ownership is rechecked after the pair lock.
  The regression failed before the fix and passed afterward. Focused PostgreSQL
  profile, sharing, Connections and schema checks: **45 passed, no skips**; F/E9
  lint and whitespace checks passed. An initial test invocation used the wrong
  working directory; rerunning from backend resolved collection.
- Both PRs belong to the authorized owner account, so GitHub self-approval is
  unavailable. Record review results without substituting another account.
- Owner requested both PRs ready. Mark #295 ready after final hosted CI, preserving
  the merge order **#293, then #295** and all individual commits. No merge occurs
  in this task. Production migration/phone checks remain release prerequisites,
  not a prerequisite to merging these feature branches into `develop`.

### #294 complete mutual Connections — reviewed, merge after #293

- [PR #295](https://github.com/Coding-Moves/one-concept/pull/295) targets `develop`
  from `codex/294-mutual-connections`. Merge profile PR #293 first.
  Its current develop diff includes that dependency; compare against
  `codex/267-complete-profile` to review Connections alone. No merge is authorized.
- `1e3f522`: constrained schema, private API and request controls; `9d28063`:
  account-safe client and invitation-only cooldowns; `d6969d1`: full mobile
  lifecycle and browser acceptance; `8ae1269`: blocking races and pagination;
  `a04dd43`: privacy disclosure; `177d3f8`: wait for status before the offline test.
  `400dc2e` preserves the latest profile share-sheet commits through a branch merge.
- Covers opt-in requests, explicit acceptance, decline/cancel/remove/block/unblock,
  private paginated lists, online-only mutations and server limits. Profile/QR
  work stays in #293; there is no XP, leaderboard, public graph or paid service.
- Passed: full PostgreSQL 16 suite **275 tests, no skips**, then **16 Connections
  tests** including three additional race/pagination cases; mobile TypeScript
  and **80 Node 24 tests**; backend F/E9 lint; web export. Final mocked browser
  checks passed for both profile and Connections at 320px in both themes,
  including failed saves, offline request retry and all relationship actions.
  The offline fixture initially disconnected before status finished loading;
  synchronizing that prerequisite resolved the test failure.
- Migration `0030_connections.sql` follows #293's 0028/0029. Production ledger,
  settings, users and release/runtime versions are unchanged. Physical two-phone,
  native sharing, camera/deep-link and TalkBack checks remain before publication.
  See [connections.md](connections.md) for the rollout and acceptance checklist.
- Handoff: final hosted CI and review results are recorded on #295. Owner merges
  #293 first, then #295 with green checks. Neither merge nor mobile publication
  is part of this task.

### #267 complete learner profile with opt-in sharing — completion review

- PR [#293](https://github.com/Coding-Moves/one-concept/pull/293) keeps all profile
  work together on `codex/267-complete-profile`, targeting `develop`.
- `271f14e`: preferred-name editor, validation and confirmed account-safe cache/
  greeting refresh. `d9cd8b0`: private-by-default field sharing, earned-award
  allowlist, random revocable links, anonymous public HTML/JSON, RLS and contract.
  `51ae52f`: preserve existing learning timezones during automatic phone sync.
  `d374fcd`: privacy UI, native Share, local QR and uncached incoming-link view.
  `5372fd3`: reminder permission/network feedback, retry and account-scoped cache.
- Validation: full PostgreSQL 16 backend suite **260 passed, no skips**; backend
  F/E9 lint passed; mobile TypeScript and **77 Node 24 tests passed**. Mocked
  browser acceptance checks passed in both themes at 320px for failed/duplicate
  name saves, confirmed header updates, reminder errors, field opt-in, QR,
  conflicting privacy saves and disabling sharing. Earlier test failures were
  resolved: stored-streak assertion now distinguishes the boolean visibility
  preference, and browser fixtures acknowledge awards before navigating.
- Migrations `0028_public_profiles.sql` and `0029_profile_timezone.sql` remain
  unapplied to production; the ledger is unchanged. Deploy schema/backend before
  mobile publication. No production settings, data, release version or runtime
  were changed. See [profile-sharing.md](profile-sharing.md) for rollout and
  required physical-phone/TalkBack/native-share/camera checks. Browser fallback
  works independently of optional verified HTTPS App Links, which need separate
  domain/native configuration; those associations are not claimed complete.
- Exact Expo SDK 57 docs were reviewed. Public QR is pure JavaScript and uses the
  existing API hostname; no new paid service or native package is introduced.
- Follow-up: use the supplied screenshots as inspiration for a dedicated share
  preview sheet, local avatar and QR card. Preview data comes only from the public
  API allowlist; native Share is revalidated before use. No XP, leagues, leaderboard,
  subscription promotion or external images were added.
- User authorized a separate complete Connections issue/PR after #293. Created
  [#294](https://github.com/Coding-Moves/one-concept/issues/294), with mutual request,
  accept/decline/cancel, private lists, remove/block/unblock, server abuse controls
  and acceptance tests in one scope. Keep this out of #293. Neither PR is
  authorized to merge without the owner's specific confirmation.

### #265 multilingual daily digest, flashcard, and quiz content — architecture recorded

- Scope: planning only. `docs/multilingual-content/README.md` records canonical
  concept localization, reviewed complete-payload fallback, locale preferences,
  translation-version provenance, and the later separate study-card/game model.
- No schema, mobile or backend runtime behavior, content translation, user data,
  release configuration, deployment or production setting changed. The owner
  requested this tracker be closed after the documentation PR is opened; future
  implementation requires a new focused issue and PR after pilot-language,
  fallback, reviewer and content-pack decisions are made.

### #258 serious learning and activity analytics — ready for review

- Scope: add one authenticated, server-derived analytics read model and a quiet
  mobile Analytics screen. It will combine completed concepts, reviews, weekly
  quiz attempts/scores, streaks, timezone-correct recent activity, actual topic
  distribution, learning-path progress and achievements without client counters
  or a productivity-dashboard score.
- `41707a8` adds the protected `GET /v1/me/analytics` endpoint, bounded
  timezone-correct aggregation, typed response contract and PostgreSQL coverage.
  `6ceb7e4` adds the typed, account-fenced mobile API client; `eea476e` adds the
  Profile-linked screen with empty, loading, pull-to-refresh and safe recovery states.
- Passed: backend F/E9 lint, Python compilation and the focused PostgreSQL
  analytics suite (**2 passed**); mobile TypeScript. The full mobile Node run
  has the pre-existing ignored-public-config assertion failure; all other 71
  tests passed. GitHub’s Backend lint and tests and Mobile typecheck and tests
  checks are green. No migration, production content, production user data,
  release version or deployment belongs in this PR.
- Review corrections: `271b097` keeps the back control in the conventional left
  position and formats server-supplied local activity dates without using the
  device timezone. `79f551a` adds profile-timezone window bounds before activity
  grouping; `f43054e` disambiguates the generated date series, with the real
  PostgreSQL integration test proving the endpoint now returns its contract.
- PR [#291](https://github.com/Coding-Moves/one-concept/pull/291) targets
  `develop` and declares `Closes #258`. It is ready for review; no merge,
  release or deployment action has been taken.
- The exact Expo SDK 57 documentation was reviewed before mobile work. The
  screen uses existing React Native primitives and project UI components; no
  native dependency is needed.

### #259 expanded achievements — merged

- Scope: extend permanent, optional recognition beyond streaks without changing
  the daily-learning, streak or offline-write contracts. Definitions cover
  concepts, reviews, distinct weekly quizzes, perfect weekly scores and distinct
  completed learning paths; no leaderboard, adaptive score or client-side award
  exists.
- `33af2e5` adds migration `0027`, definition metadata, source constraints and
  a historical backfill. `c251da0` adds the shared server evaluator, confirmed
  progress response and weekly-quiz transaction integration. `73d3542` makes
  the mobile collection show every category and its server-confirmed nearest
  target while retaining account fencing and one-time acknowledgement.
- PostgreSQL coverage proves threshold dates, quiz retry deduplication, exact
  perfect scoring, distinct-subtopic counting, RLS denial and category progress.
  The schema contract was regenerated from a disposable PostgreSQL 16 instance.
  Mobile TypeScript passed; all mobile Node tests passed except the pre-existing
  ignored-public-config assertion, caused by this checkout intentionally lacking
  a public API URL. No production migration, user-data change, deployment,
  version or release configuration has occurred.
- Review correction: `eca8237` removes an unused test import and restores the
  service import ordering so the backend's required F/E9 lint check stays clean.
- PR [#290](https://github.com/Coding-Moves/one-concept/pull/290) was merged by
  the owner. Staging must apply and verify migration `0027` before production;
  do not add it to `backend/migrations/applied.txt` until actual production
  verification.

### #262 optional repeatable subtopic quizzes — ready for review

- Scope: provide an optional, Profile-linked quiz only after a server-confirmed
  subtopic completion. It remains separate from the weekly cross-concept quiz,
  daily learning, streaks, achievements and release configuration.
- `66c2ba5` adds the immutable quiz/attempt storage; `81d1fc2` adds the
  server-owned snapshot, scoring, protected endpoints and integration coverage;
  `f0dfb86` records the reviewed schema contract. `bfc3b40` covers Profile’s
  completion-ID contract; `544c0a2` adds the dedicated mobile list/detail
  screens; `6f889b4` adds composite database ownership constraints and a
  cross-account regression; `8153f7a` rejects unknown history IDs and uses
  lint-clean typed FastAPI dependencies.
- A quiz freezes one deterministic reviewed MCQ per selected completed concept,
  up to seven. It stores source slug/version and answer key in the server-only
  snapshot. Later content changes cannot alter an existing quiz; each retry
  appends a score and selected-answer record, while history keeps prior scores.
  The feature honestly reports unavailable until enough reviewed MCQs exist.
- Passed: full disposable PostgreSQL backend suite; focused quiz/completion/
  weekly-quiz coverage (**13 passed**); regenerated schema contract; mobile
  TypeScript and all **71** Node tests. No production migration, user-data
  change, deployment, app-version or release configuration was performed.
- PR: [#289](https://github.com/Coding-Moves/one-concept/pull/289) targets
  `develop` and declares `Closes #262`. Obtain normal review and staging
  validation before any merge.

### #261 server-authoritative subtopic completion — ready for review

- Scope: detect completion against every currently published concept in an
  active subtopic, show one quiet confirmation after the accepted daily write,
  and expose server-derived path progress in Profile. Topic follows remain a
  recommendation preference and do not alter the completion boundary.
- `ab98efa` adds the dedicated consumption/event schema and historical
  backfill. `d1d914e` evaluates and persistently deduplicates an exact catalog
  completion under the existing profile lock, returns it from daily completion,
  and adds protected progress/acknowledgement APIs. `81affb6` adds the
  confirmation card and Profile summary. `2f6c444`, `69fa871`, and `3d095b7`
  isolate catalog-growth tests, refresh the generated schema contract, and
  cover the HTTP contract.
- Review correction: `565ef8d` adds `0024` to backfill already-complete
  subtopics for existing users as seen historical events; `375a2de` refreshes
  its generated schema contract. This prevents the Profile from incorrectly
  showing a previously finished path as active forever.
- A catalog event stores the sorted published concept IDs plus a stable
  signature. Adding a new published concept makes the current path active
  again; revising existing material does not. Empty or retired subtopics are
  not reported as completed. Reviews do not add concept consumption.
- Passed: PostgreSQL 16 focused completion/API/schema suite, including exact
  boundary, replay, catalog growth, concurrent-device serialization and RLS;
  mobile TypeScript. The complete mobile Node suite has one pre-existing local
  public-config failure because this checkout’s ignored `.env` intentionally
  omits an anonymous key. No production migration, production data, deployment
  or release configuration changed.
- Next: push the dedicated `develop` PR with `Closes #261`. #259 will consume
  the completion-event data for achievement definitions; #262 will consume it
  for the optional subtopic quiz. They intentionally remain separate.

### #263 remote content-review dashboard — planning complete

- Assigned scope: refine the parent issue and create dedicated sub-issues for
  invited reviewer access, versioned human approval, review APIs, bounded AI
  revisions, the branded web workspace, email deadlines, learner attribution
  and free frontend deployment. This is issue planning, not implementation.
- Reuse the existing editorial services and coordinate with #264 quality,
  #255 staging, #256/#257 content packages and #171 email delivery. Preserve
  existing published lessons without inventing reviewer provenance; new
  content must pass exact-version human approval before learner publication.
- Recommend static React/TypeScript/Vite on Cloudflare Pages Free with the
  existing FastAPI/Supabase stack. Free frontend hosting does not remove
  backend, AI or email quotas/costs. No paid setup or live deployment performed.
- Delivery boundary: one focused future PR per child with small coherent
  commits; no application-code commit is planned for this tracker-only task.
  The unrelated mobile UI changes in the owner checkout remain untouched.
- Updated [#263](https://github.com/Coding-Moves/one-concept/issues/263) and
  created native sub-issues #274–#281 in the order above. Read-back verified
  every body, all eight parent-child links and Muawiya-contact authorship.
  Existing related issues remain separate dependencies. Whitespace check
  passed; no application tests were needed because this task changes no code.
- Next implementation slice: #274 reviewer identity plus the #275 provenance
  contract, each in its own focused PR. Deadline length and email sender
  feasibility remain explicit setup decisions. This local work-log note is
  uncommitted; no unrelated branch or production setting was changed.

### #273 cohesive mobile UI/UX refinement — in progress

- Scope: one dedicated mobile PR that builds on the merged #271 readability
  fixes. It will establish a small shared visual foundation, apply it across
  learning, collections, progress, profile, authentication and recovery
  surfaces, and preserve the existing account, offline and API behaviours.
- Planned commits: visual tokens and shared feedback primitives; learning and
  collection screens; progress and profile/account surfaces; accessibility and
  regression coverage; then the PR handoff. No native dependency, release
  version, backend, schema or production change is part of this work.
- Expo SDK 57 documentation was reviewed before mobile implementation. The
  project can use the built-in React Native Animated API for short motion, so
  this work will not add a native animation dependency.
- Related issue #271 is already merged through PR #272. This PR must retain
  those fixes and close #273 only; it must not claim to close an issue that is
  already closed.
- `24418cf` adds the semantic visual foundation, shared screen/surface
  components, 44-point primary/follow controls, reduced-motion-aware tap
  feedback, and the refined Today hierarchy. `83fe5de` clarifies Stats;
  `a4e2ea2` refines History/Saved collection feedback; `2bbc20a` aligns
  auth/profile states; `e41d649` aligns personalisation and About;
  `0bc2ae3` replaces the recovery loop with a short entrance motion and makes
  paused-sync recovery explicit. `86bbef6` updates the mocked browser coverage;
  `3dd6a3e` guards feedback and subtle-surface contrast in both themes.
- Passed: mobile TypeScript and all **69 Node 24** tests. A clean dummy-config
  web export was produced at `/tmp/one-concept-273-web-final`; no production
  service or user data was used. The optional mocked-browser scripts could not
  run locally because Playwright is not installed. Android/iOS physical-device
  checks for system font/display scaling, TalkBack/VoiceOver and reduced motion
  remain required before release.
- Next: push the dedicated branch and open a `develop` PR with `Closes #273`.

### #271 mobile readability and collection layout — ready for review

- [PR #272](https://github.com/Coding-Moves/one-concept/pull/272) targets
  `develop` from `codex/271-mobile-ui-readability` and closes #271 on merge.
  Started from `1d77a34`; unrelated owner-checkout work was preserved.
- `0f6c718` improves theme contrast and thin component outlines; `198b87a`
  replaces catalog fractions/bars with learned-only Stats and compact reviews.
  `a43cc05` adds signed-in top/side safe-area ownership and prevents Saved filter
  compression; `fa0949f` preserves unavailable review totals rather than zero;
  `aad36e0` wraps narrow Saved headings; `9d655c4` adds browser regression coverage.
- Reviewed Expo SDK 57 and safe-area-context documentation. Zero reviews is
  valid when no assigned review was completed; reading new or saved lessons
  does not increment it. No production user data was inspected.
- Passed: TypeScript, all 68 Node 24 tests, dummy-config web export, new
  light/dark readability browser scenario, existing review, History and
  learning-UI browser scenarios, and whitespace checks. Review tests cover
  deduplication, offline restart/reconnect and unchanged unique learned totals.
  New UI checks cover catalog growth, older-topic aggregates, zero/nonzero/
  unavailable review totals, Saved search/filtering and 320px enlarged chips.
- Generated eight local screenshots in `/tmp/one-concept-271-screens`; inspected
  Today, Stats and enlarged Saved output. Physical Android/iOS safe areas,
  native font/display scaling and screen readers remain manual acceptance;
  browser enlargement does not prove native behavior. Device checklist is in
  `mobile/tests/README.md`. Backend tests were not run locally: no backend changed.
- Review follow-up: merged develop `4cebf61` in `c086e2b`, preserving both work-log
  entries and all commits. `10ba0cd` responds to the owner's visual feedback with
  shared half-point outlines, including Stats, action groups and navigation.
  `b7f4acd` fixes an identified review edge case: offline completion must preserve
  an unavailable lifetime review total, not fabricate one. Its regression covers
  replay, repeated completion and rollback.
- Revalidated: TypeScript, 69 Node tests, web export, both-theme readability and
  review browser scenarios. The PR description carries the current validation
  and remaining native-device checks. No remaining blocking code finding was
  identified in the reviewed mobile diff.
- Final owner design supersedes the earlier broad-outline approach: retain a
  0.5-point border only on Today's green completion pill. Other UI containers,
  filters, inputs, action groups and navigation are borderless; existing badge
  illustrations retain their artwork. Removed the broad outline token and
  updated browser assertions to require borderless cards/filters/search.
- No native dependency/runtime/version, schema, production deployment or release
  change. Hosted PR checks are pending at handoff. Keep commits separate;
  merge requires owner confirmation. Final bookkeeping commit updates this log
  and the codebase map.


### #260 topic and subtopic taxonomy — in progress

- Scope: a dedicated PR for the first item in the owner-approved sequence. It
  gives the existing five topics a durable, parent-scoped subtopic registry and
  classifies every existing published lesson and planned backlog item. New
  plans, generated drafts and editorial revisions must carry that category.
- Commits: `bedf72a` adds the taxonomy migration, SQLAlchemy mirror and curated
  registry. `52d7ec9` classifies legacy backlog and carries subtopics through
  curriculum import, generation and review. `3604f2d` exposes the category in
  daily/concept responses while preserving already assigned material if a
  subtopic is retired.
- Validation: Python compilation and whitespace checks passed. Focused
  generation checks passed (**17 passed**). The focused PostgreSQL-backed
  curriculum/publication/selection/year checks were collected but skipped
  (**20 skipped**) because Podman is not installed locally; GitHub's disposable
  PostgreSQL 16 quality gate remains required evidence. No production migration,
  deployment, release, or app update has occurred.
- PR: [#270](https://github.com/Coding-Moves/one-concept/pull/270) targets
  `develop` and uses `Fixes #260`; it remains open for owner review.
- Review follow-up: GitHub's PostgreSQL suite exposed temporary-topic teardown
  failures because the test fixture adds a subtopic. `0019` makes only an
  otherwise deletable topic cascade to its private taxonomy; populated topics
  remain protected by the existing content and user-topic foreign keys.
- Second review follow-up: after #269 became the current base, its schema gate
  correctly rejected the taxonomy migrations until the reviewed contract
  included subtopics and `0017`–`0019`. The temporary retirement regression now
  restores its fixture subtopic after the daily-selection function commits.
- Local verification after those corrections: full disposable PostgreSQL 16
  backend suite passed (**217 passed**, no skips); Ruff on the changed schema
  verifier and regression test passed. Await the hosted rerun before treating
  the PR as green.
- Next: review the PR and its PostgreSQL quality-gate result; do not merge or
  apply the migration until the owner approves it.
### #165 verify deployed schema — dedicated fix

- Owner requested a focused PR independent of deferred VM draft #231. Branch
  starts at develop 61efc97; the VM draft and its history remain untouched.
- `82f221b` extracts the read-only metadata contract/verifier with negative
  database and credential-redaction tests. `7bb42af` packages it in the Railway
  image and legacy pre-deploy config. `3d7083a` adds a main-only protected check
  and makes Release OTA depend on it; ordinary PRs receive no production secret.
- Final review also preserves libpq `sslmode` as asyncpg's `ssl`, with connection
  and TLS-policy regressions. No SQL is applied and the ledger is unchanged.
- Passed: full backend suite 213 tests, zero skips, on disposable PostgreSQL 16;
  nine Node 24 release-revision tests; Ruff F/E9; Actionlint for all three changed
  workflows; local documentation links and whitespace checks. Follow-up URL
  normalization passed all 20 focused schema tests, zero skips. Docker build and packaged
  checker smoke passed for healthy schema, missing claimed_at and absent URL.
- Production was not accessed. The owner must configure GitHub environment
  production-schema (main-only, protected, PRODUCTION_SCHEMA_DIRECT_URL secret)
  and Railway pre-deploy command on each service. Missing GitHub configuration
  blocks the new Release flow; merging cannot set dashboard protection rules.
- The contract checks required schema, not seed/backfill contents or migration
  execution history. PostgreSQL-version differences need reviewed investigation.
  Operating instructions and draft #231 reconciliation are in
  [SCHEMA_VERIFICATION.md](SCHEMA_VERIFICATION.md).
- Documentation/handoff commit: `docs: explain schema gate setup and validation`.
- Opened [PR #269](https://github.com/Coding-Moves/one-concept/pull/269) against
  develop with `Closes #165`. Five focused implementation/documentation commits
  preserve the scope; no PR merge, deployment or source-draft modification.
  Hosted PR checks are pending at opening. This handoff commit records the PR.

### PR quality-gate PostgreSQL readiness follow-up — ready for review

- GitHub-hosted CI exposed a real fixture race: `pg_isready` could succeed against the official PostgreSQL image's temporary initialization server, which then stopped before the migration harness ran.
- `b3719bd` waits for a TCP `psql` query instead, proving the final server has started before applying migrations. A timeout now reports the last container log output as a test failure rather than silently skipping database coverage.
- Passed: full disposable PostgreSQL 16 backend suite (**195 passed**) and Ruff `F,E9`; no production database or credential was used.
- Follow-up PR: [#252](https://github.com/Coding-Moves/one-concept/pull/252).
### 1.10.1 release preparation — ready for review

- Scope: current `develop` changes since `v1.10.0` on `main`: reliable paused-sync recovery and account fencing, friendly service/configuration recovery screens, safer authenticated API limits, regression coverage, quality-gate groundwork, and current developer documentation. No database migration is introduced by this release range.
- `efe5270` updates `mobile/app.config.js` to marketing version `1.10.1` and adds the required nonempty `1.10.1` one-time What's New card. It describes learner-visible recovery, retry, account-protection and setup guidance benefits. `runtimeVersion` remains `1.10.0` because the release has no native change.
- Release preparation must merge into `develop` before opening the final `develop` → `main` release PR. That final diff must retain both the version and its matching card; mobile publication remains a separate verified action after production deployment checks.
- Release preparation PR: [#251](https://github.com/Coding-Moves/one-concept/pull/251).

### #162 PR application quality gates — 2026-09-26

- Confirmed the remaining gap: the release guard is path-scoped and the weekly audit is advisory, so ordinary PRs into `develop` did not run the mobile suite or backend pytest.
- `eda63f3` adds stable, credential-free PR checks for `develop` and `main`: Node 24 mobile typecheck/tests; backend Ruff F/E9; and the existing backend pytest suite using its disposable Podman PostgreSQL 16 fixture. The backend job fails if that fixture skips, preventing a green result without database coverage.
- Review follow-up `538d6b0` supplies only safe test configuration required during backend test collection (`DATABASE_URL` for the disposable database and `.invalid` Supabase placeholders). No production credential or service is exposed to PRs.
- `19a168d` documents the exact local commands and `0bebc4f` corrects the codebase map. Required-check enforcement in GitHub branch rules remains an owner/repository-settings action after the workflow first appears; a workflow file alone cannot claim it is required.
- Passed: workflow YAML assertions, mobile Node 24 typecheck and all 49 Node tests, backend Ruff F/E9, and a clean PostgreSQL-backed selection module (9 passed). A full local backend run was started twice accidentally while collecting asynchronous terminal output; the duplicate runs contended for the fixed disposable container and were stopped, so that full-suite attempt is not counted as a pass. GitHub Actions must run the full suite once this PR is opened.
### #157 mobile regression coverage — ready for review

- The issue's original zero-test diagnosis is historical: `develop` already uses Node 24's built-in runner and existing queue/browser regressions. This dedicated PR extends that single test stack rather than introducing Jest or another runner.
- `1d14ca4` covers deterministic daily selection, assigned-day stability, learned-pool selection and unavailable assignments. It also corrects type-only imports so the existing Node runner can load the pure selector.
- `63ed4a5` covers duplicate learning records, unfinished-day continuity and year-boundary streaks, with the same type-only import correction and narrowly scoped Metro-compatible source resolver for tests.
- `edd1f7d` proves a thrown replay callback continues the sync loop's retry rather than leaving durable offline work idle.
- Validation: clean `npm ci`, `npm test` (**60 passed**), `npm run typecheck` and `git diff --check` passed. `npm ci` reports 11 existing moderate dependency advisories; this test-only PR does not alter dependency versions.
### #153 authenticated endpoint rate limits — ready for review

- Confirmed `develop` had no limiter. The dedicated PR applies separate per-verified-account token buckets for reads and writes after JWT verification, protecting database-facing state and mutation routes without trusting request headers or user IDs.
- `3fe53a4` supplies configuration defaults, bounded in-process bucket storage, structured 429 responses with `Retry-After`, CORS header exposure and regression coverage for refill, method isolation, bounded memory and spoof-resistant identity. It preserves the established outage exception handlers during the conflict resolution.
- The PR description will use `Fixes #153`, so GitHub closes this fully resolved issue only when the PR merges.
- Review follow-up `4b366eb` removes an unrelated `APP_REVISION` setting carried from the #169 draft, keeping this PR limited to throttle configuration.
- Passed: focused rate-limit/security suite (**12 passed**) with dummy local settings and `git diff --check`. The full suite collected 195 tests and ran 41, then 154 database tests errored when the local Podman PostgreSQL 16 container stopped during migration setup; this environment failure is not counted as a pass or attributed to the limiter.
### #164 developer onboarding and accurate backend guide — ready for review

- Confirmed the documented test count and abbreviated route map were stale; the backend now has a wider regression suite and authenticated routers for profile, concepts, reviews and achievements in addition to topics/daily. The layout uses descriptive coverage rather than a hardcoded count.
- `91fbb25` corrects the backend layout/endpoint guide. `425fc6f` adds `mobile/README.md` with clone-to-Expo setup, safe public configuration, architecture navigation, offline/account rules and local validation commands.
- This documentation-only PR uses `Fixes #164`; no runtime behavior, deployment, environment values or secrets changed. Local link/path and whitespace verification passed; tests were not run because no executable code changed.
- Review follow-up `124250b` makes every mobile service reference in the application map an unambiguous repository path.

### #156 offline queue retry and account boundary — 2026-09-26

- Confirmed the current `develop` defect: a 5xx replay loop had no persisted retry limit, and a queued replay could acquire a replacement account token during sign-out/sign-in.
- `d06d7ef` fences token lookup, network completion and JSON parsing to the account epoch. It adds focused tests proving a queued write cannot be sent with a next-account token and a late old-account response cannot affect the new account's connectivity state.
- `2c9b098` persists a per-intent exponential backoff (5 seconds to 5 minutes), pauses after eight automatic failures, respects `Retry-After`, and preserves a newer same-key choice. Retryable daily, review, topic, like and save writes share the policy.
- `6a7a04b` exposes paused changes with an accessible Retry saved changes control, clears the pause only on deliberate retry, and adds an exported-app browser scenario for repeated 503s, restart, and recovery.
- Passed: TypeScript and all 58 Node 24 tests. The optional Playwright browser scenario needs a local Playwright module and browser executable; it was syntax-inspected but not run on this workstation. No production service, schema, EAS update, or release changed.

### #155 public mobile configuration gate — 2026-09-26

- Confirmed #243 already fixes the runtime failure: missing API or Supabase configuration renders the configuration state, does not masquerade as offline, and does not start mutation replay.
- This dedicated follow-up prevents an invalid public configuration from reaching a build or OTA publication. `acfca93` validates required public endpoints/key, rejects malformed or unsafe release URLs without echoing values, and adds 3 focused tests. `42b3bb8` validates the selected EAS preview/production environments before publishing updates.
- Passed: validator with dummy public values, JavaScript syntax checks, TypeScript, all 52 Node 24 mobile tests, and whitespace checks. No EAS environment, production deployment, OTA publication, migration, or release was changed.

### #154 reconnect replay race regression — 2026-09-26

- Current `develop` already serializes reconnect queue replay through the same ProgressContext mutation chain as optimistic taps. This focused PR supplies the missing deterministic proof instead of reimplementing that behavior.
- `443f46e` adds a mocked exported-app browser scenario: it holds a reconnect snapshot, applies a later Save, releases the stale snapshot, then rejects an Unlike while Unsave is pending. The assertions require the later action to remain visible, unrelated rollback to stay isolated, and the durable queue to drain.
- Passed: browser-script syntax, TypeScript, all 49 Node 24 tests, and whitespace checks. The mocked browser scenario is not locally runnable because Playwright is absent; CI or a Playwright-equipped workstation must run `offline.browser.cjs --flush-race`. No production change, migration, or release is included.

### #242 graceful outage recovery — 2026-09-26

- Scope: a dedicated reliability PR only. Related #161, #169, #171, #187, and #155 remain open and are not closed by this work.
- Review found that an absent Supabase URL could throw during module import before the planned configuration screen could render. The recovery path now uses a safe placeholder client only while the app shows a configuration state; no request is made in that state.
- `fee9ce3` adds sanitized FastAPI SQL/database and unexpected-failure responses with opaque incident IDs, retry guidance for database failures, and regression tests. `85536da` adds shared mobile error types and non-diagnostic recovery classification. `d4d2185` adds root render recovery, import-safe configuration handling, and the support action. `5a46b03` routes topic, history, and concept failures into the shared safe unavailable state. Review follow-up `33146f0` keeps the splash-owning layout outside the boundary so a caught startup failure can still reveal the recovery screen.
- `docs: document outage recovery operations` adds the operator triage/recovery guide and updates this map.
- Passed: focused backend response tests; mobile TypeScript and all 49 Node 24 tests; whitespace checks. The full backend suite was attempted with dummy local settings and PostgreSQL 16: it showed four failures and one error by 74%, then stalled in the local harness and was stopped; it is not counted as a pass. No production deployment, migration, release, or merge occurred.

### #230 Railway account migration — in progress, 2026-09-26

- Owner requested one migration PR and performs Railway changes manually.
  Scope: preserve the existing Supabase project, replace the API and two cron
  workers, migrate mobile endpoint configuration, then retire old infrastructure.
- Isolated branch starts from develop 7e18b44; main is 5ebdea4 (release 1.10.0)
  with the same tree. VM draft #231 and other worktrees remain untouched.
- Planned focused commits: account-migration runbook and evidence; release-guide
  integration and handoff. No app source change or native rebuild is required
  merely to change EXPO_PUBLIC_API_BASE_URL.
- Destination Full Trial is owner-reported. New API public /health returned HTTP
  200 with database reachable. Worker screenshots prove import-only tests; owner
  reports reminder logs are fine after handover, but exact run evidence and old
  worker retirement are not independently verified. New pool-topup generation
  was last confirmed false; the owner intends to enable it, but effective
  settings and scheduled generation are not proven.
- Owner added the recovery redirect and changed EAS production/preview endpoint
  values. Direct reads confirm both now target the replacement API. Actual
  password recovery remains unverified.
- CLI and SSH identity verified as Muawiya-contact; configured author matches
  the profile. Backend behavior and native runtime stay unchanged. Owner now
  reports a successful production phone smoke check; request attribution, worker
  outcomes and retirement remain pending evidence.
- `3e0ba41` adds the runbook. Owner intends to enable destination generation
  and delete the source project; at that stage the production EAS URL still
  targeted the source. No deletion or generation activation claimed.
- Release-guide integration documents the endpoint-only OTA path and the existing
  release workflow's partial-publication risk when rerun for an existing tag.
  `eda36c0` contains that integration. Local documentation links, source/command
  inspection and whitespace checks passed; no code or workflow behavior changed.
- Opened draft [PR #240](https://github.com/Coding-Moves/one-concept/pull/240)
  against develop. Application tests were not rerun for unchanged application
  source. Draft status does not mean production migration is complete.
- Handoff commit: `docs: record migration PR and validation status`.
- Published endpoint-only production OTA group
  `f77ba7d7-e5ca-4097-b393-03ea17d9c473` at 2026-09-26 10:14 UTC, Android/iOS,
  environment production, unchanged version/runtime 1.10.0, clean released
  source `5ebdea4d796a916862181dc9a47a0b20c9d90c30`. Production channel readback
  confirms this group. Previous group `e937609c-49f8-4238-a5f6-18672b3c0c0f`
  retained as rollback reference. No new tag, APK, schema or app-source change.
- Passed: Node 24 npm ci, clean Android/iOS exports, binary inspection showing
  new API present and old hostname absent, both API health checks (database
  reachable), unauthenticated daily-route 401, and matching Supabase recovery
  page configuration. Owner subsequently confirmed the production phone works,
  including history and version checks; update ID/API traffic was not observed.
- Direct manifest-permalink retrieval returned HTTP 403, so an independent
  CDN payload download is not claimed. EAS upload succeeded and authenticated
  channel readback confirms the group, runtime, environment and clean source.
- Preview environment changed but preview OTA was not overwritten: its latest
  source revision differs. Runtime 1.3.0 devices still require a separate path.
- Publication evidence handoff: `docs: record production endpoint OTA publication`.
- Owner requested PR readiness review, a refreshed summary and `Closes #230`.
  `615d455` integrates develop `cb57c6b` without rewriting commits and resolves
  the work-log conflict by preserving both sets of entries. The final PR diff
  remains documentation-only; application source matches develop.
- Readiness handoff: `docs: record handset check and migration closure scope`.
  Local links and diff whitespace checks passed. No application tests rerun for
  prose-only changes. The summary distinguishes the successful owner phone
  check from unverified worker/retirement work; issue closure is not evidence of
  fleet adoption or permission to skip the retirement gate. No PR merge or
  direct issue closure is performed by this readiness update.

### #238 developer portfolio link — 2026-09-26

- Confirmed the About footer's “Developed by @Muawiya-contact” destination still pointed to GitHub rather than the portfolio requested in the issue.
- `e2e017a` originally moved the destination away from GitHub. Release preparation follow-up corrects it to the owner-provided `https://muawiya-contact.github.io/muawiya-portfolio/`; the existing accessible link role and URL-opening fallback remain in use.
- Passed: TypeScript, all 47 Node 24 mobile tests, and whitespace checks. The portfolio URL is owner-provided; this workstation's documentation browser could not fetch the GitHub Pages host for an independent availability check.

### #236 collection UI refinement — 2026-09-26

- Confirmed the current issue: History used a separate rectangular search field and a prominent loaded-count line; Saved had compact filter controls without an explicit touch-target or label line-height; both screens duplicated collection-row layout.
- `9333b44` adds shared `SearchField` and `CollectionConceptRow` primitives, with bounded topic labels. `0884023` moves Saved to the shared search/row and makes its filter rail 44 points tall with vertical breathing room. `9296e80` moves History to the same compact search/row and places its loaded count inside the search placeholder plus an accessibility hint. `4fe7a89` updates bounded-history browser assertions; `bbc7b51` restores the Saved back control to a 44-point target. Review follow-ups `0446787` raise collection controls to Android's 48dp target and `25c72f0` ensures a long server-supplied category label stays within a compact row.
- Passed: TypeScript, all 47 Node 24 tests, a clean web export, and whitespace checks. The exported-app Playwright scenarios could not run on this workstation because the optional `playwright/test` module is absent; no dependency was added only for validation. Physical Android/iOS large-text, TalkBack/VoiceOver, and screenshot review remain required before release.

### Release #233 review follow-up — 2026-09-25

- Scope: record owner-confirmed production application of migration 0016 and
  fix the reviewed badge-dismissal hydration race, in separate focused commits
  within one follow-up PR targeting develop. Release #233 then receives both.
- Owner reported the complete migration succeeded and the verification query
  returns both achievement tables. Ledger updated from that evidence; no
  production connection or independent policy/constraint inspection claimed.
- Current release head is `ac72cba`; its rerun still fails because the ledger
  change has not reached develop. Merely rerunning that head cannot fix it.
- `cd0cf6a` records owner-verified migration application; `291570c` shares one
  initial cache read and waits for it before refreshing, preserving offline
  dismissals and acknowledgement retries. Sign-out still fences pending work.
- Passed: TypeScript, all 47 Node 24 mobile tests, clean web export, light/dark
  achievement browser flows (dismissal, offline restart and account replacement),
  local migration ledger check and diff --check. The two slow-disk regression
  cases failed before the fix and pass afterward; a third covers sign-out while
  hydration is pending. No backend code changed, so its suite was not repeated.
- Validation documentation commit: `docs: record release review fix validation`.
  Next: publish follow-up PR, run GitHub migration check on its branch and request
  exact merge approval. Release #233 checks rerun once develop receives the fix.
- Original VM draft checkout and prior release-preparation handoff preserved.

### 1.10.0 native release preparation — 2026-09-25

- Preparation PR [#232](https://github.com/Coding-Moves/one-concept/pull/232)
  targets develop; owner requested a detailed develop → main release PR after
  requirements are checked. VM #231 and SMTP #187 remain draft and excluded.
- Scope: achievements (#228), privacy policy (#229), XML parser correction
  (#208), and reviewed dependency updates. Native Expo changes require a new
  APK/runtime 1.10.0; runtime 1.3.0 binaries do not receive this release OTA.
- `bfb1de3`: version/runtime and matching nonempty What's New; existing dismissal
  retained, with browser assertions for version, persisted dismissal and restart.
  `ce0d006`: release checklist and evidence. This handoff's commit is identified
  by subject `docs: record release preparation PR and remaining verification`.
- Passed: clean npm install, TypeScript, 44 mobile tests, Android/iOS/web bundle
  exports, nine release-revision guards, six card-layout/theme browser cases and
  light/dark achievement flows. Small/landscape screenshots inspected. Initial
  stale dummy endpoints from Metro cache were fixed by a clean test export.
- Unchanged backend at develop `9e9f802`: 191 PostgreSQL-backed tests and pip
  check passed during dependency integration, no skips. No backend code changed
  during preparation; no repeated full backend run was needed.
- Online Expo check and npm audit failed on external requests; not counted as
  passes. Offline Expo check flags baseline React/React DOM 19.2.8 versus 19.2.3.
  Seven GitHub XML advisories affect <=0.8.14; candidate resolutions 0.8.15 and
  0.9.12 are outside those reported ranges. Alerts were not dismissed.
- Owner confirmed migration 0016 is pending and will apply/verify it. Production
  ledger remains unchanged. Actual verification and exact #232 merge approval
  are prerequisites to completing the release PR. Main requires Migrations
  applied check and one approval; no rule was weakened.
- No production database writes, deployment, production OTA/tag, or cloud native
  build occurred. Native build/device checks and production API/worker revision
  verification remain rollout work; see [release checklist](releases/1.10.0.md).

### #163 privacy policy — 2026-09-25

- PR [#229](https://github.com/Coding-Moves/one-concept/pull/229) targets `develop`; it is ready for review and remains open.
- Confirmed the issue: no public policy page or in-app link existed while the app uses account identity, profile/learning data, reminder preferences and optional Expo push tokens.
- `8479116` adds a public `/privacy` page, an accessible About-screen link that resolves from the configured API origin, and a public-page regression test. The policy describes only source-confirmed data flows, local cache behavior, reminder choices and the contact route for access, correction or deletion requests.
- The branch now includes current `develop`; its documentation conflict was resolved by retaining the #209 and #163 records. Post-resolution validation: privacy route test passed with test-only configuration; mobile TypeScript and all 44 mobile tests passed. No live deployment, store-listing update, migration, release or merge was performed.
### #209 permanent streak achievements — 2026-09-25

- Scope: nine streak milestones (including 90/180 days), durable server awards,
  historical credit, account-safe offline viewing, Profile collection, details
  and grouped celebrations. No production migration, deployment or merge.
- Use existing recorded learning dates, lesson/review union and completion locks.
  Earned badges survive missed days; client clocks cannot grant awards.
- Planned commits: schema/backfill; transactional evaluation/API/tests; account
  cache/tests; provider; badge/details UI; collection/Profile; celebration;
  validation and operational documentation. Keep each change independently useful.
- Worktree isolates existing local handbook edits/backups. CLI and SSH both
  verified as Muawiya-contact; configured name/email match the public profile.
  The connector uses another identity and will not be used for writes.
- Read Expo SDK 57 documentation before mobile implementation. Migration 0016
  remains unapplied to production and must not enter the applied ledger yet.
- Delivered [PR #228](https://github.com/Coding-Moves/one-concept/pull/228) against
  develop. Permanent awards, historical reconciliation, responsive collection,
  detail sheets and grouped celebrations are implemented; no merge performed.
- Commits: `0d49545` schema/backfill; `949c273` transactional APIs/tests;
  `51491dc` account cache/request isolation; `484cdbe` provider synchronization;
  `d90b255` badge/detail presentation; `0eadcfa` Profile/collection;
  `f84eb8a` celebrations; `8ea5ee1` rollout-gap reconciliation;
  `2625c87` browser regressions/contrast; `2c6481f` architecture/rollout guide.
  This handoff is a separate `docs: record achievement validation and PR handoff` commit.
- Final validation: PostgreSQL 16 full backend suite **190 passed, zero skips**;
  targeted achievements **18 passed**; Node 24 mobile **44 passed**; TypeScript,
  Ruff F/E9, whitespace checks and Android/iOS/web exports passed.
- Mocked exported-app browser scenarios passed in both themes: grouped historical
  rewards, What's New ordering, dismissal, locked/unlocked cards, detail contrast,
  narrow/enlarged text, offline restart and delayed A-response after B sign-in.
  Light/dark screenshots were visually inspected. Account-store tests additionally
  cover direct replacement without sign-out, cache epochs and storage failures.
- Validation used local test services only. Original handbook edits/backups remain
  untouched. Physical Android/TalkBack and native system font/Back checks remain
  outstanding. Server acknowledgement has the cross-device/offline limits documented
  in ACHIEVEMENTS.md; earned awards remain permanent and unique.


### #207 XML parser patch and mobile publication status

- Owner requested a fix PR and the new version/card on the phone and GitHub.
- Confirmed the audit's high finding in @xmldom/xmldom 0.8.14, used by
  expo-updates → @expo/plist. A targeted lockfile update selects compatible
  0.8.15 without changing Expo, native runtime or app version (still 1.9.1).
- Audit before: one high, zero critical, 18 moderate. After: zero high/critical,
  18 moderate; the XML finding is absent. Moderate findings remain disclosed.
- `7f6169b` patches the dependency. Clean npm install, Node 24 TypeScript checks,
  all 39 tests and clean Android/iOS/web exports passed. A focused runtime check
  confirmed malformed PI rejection with the supported serializer options and
  preserved Expo plist roundtrip values. Initial ad-hoc checks used the wrong
  API signature/default export; corrected checks pass. No app source changed.
- Browser checks in both themes passed: upgrades from 1.8.0/1.9.0 show four
  1.9.1 highlights and dismissal survives reload. Physical-device OTA unverified.
- PR [#208](https://github.com/Coding-Moves/one-concept/pull/208) targets develop;
  the fix and this validation record use separate commits. GitHub default-branch
  dependency alerts remain a separate scope from the mobile npm audit result.
- Production 1.9.1 release publication is still pending. Owner sees green Railway
  deployments but cannot confirm all worker revisions; in-app Railway view stalls.
  Never attest an unverified worker revision merely to dispatch the release.


### Permanent release/card requirement and 1.9.1 handoff

- Owner reiterated that every release PR must contain both the version bump and
  its matching one-time What's New card, and explicitly document both in that PR.
  Strengthened AGENTS.md and RELEASING.md with final-diff verification; this applies
  automatically to future releases without another reminder.
- Release [#205](https://github.com/Coding-Moves/one-concept/pull/205) includes
  version 1.9.1 and its four highlights. The durable rule landed on develop
  through #206 after #205 was merged by the owner. The existing dismissal
  remains once per version; preview/card checks are recorded below. Main now
  includes 1.9.1, but no production OTA has been published for it.
- Documentation validation: referenced paths exist and whitespace checks passed.


### Requested 1.9.1 release and visible What's New verification

- Owner requested another version/release PR after 1.9.0 merged but was not
  published to phones. This is a new version/card entry, not a claim that another
  feature implementation is needed or that a version bump publishes an OTA.
- Prepare 1.9.1 with four concrete learning benefits, retaining the existing
  modal and per-version dismissal. Runtime stays 1.3.0; 1.9.0 highlights remain.
- Intended commits: matching app version/card, then verification and handoff.
  Production release stays separate from the backend deployment confirmation.
- `3feaed4` adds the requested version and highlights. Node 24 typecheck and all
  39 tests passed. Clean Android/iOS/web exports passed; mocked browser checks
  in both themes confirmed four highlights for 1.8.0/1.9.0 upgrades and persistent
  dismissal after reload. Preview screenshots were inspected.
- Initial web verification exposed stale local Metro version metadata; clearing
  the shared build cache produced the correct 1.9.1 manifest. No app behavior
  was changed to compensate for a local cache. Physical OTA remains untested
  until backend verification and publication. Preparation PR #204.


### Release #200 readiness and deployment ordering

- Owner requested a merge-ready release, with production merge left for approval.
  Railway screenshot confirms main auto-deploy with `/backend` root directory.
- Separating the backend merge/deploy from mobile publication. Release becomes
  manual on main with a required full deployed-commit attestation; a guard rejects
  wrong branches, missing/mismatched SHAs and a main revision changed since dispatch.
  Standalone EAS Update remains preview-only so it cannot bypass the release gate.
- This attestation is not automatic Railway verification. After merging main,
  inspect API/worker deployments and health before dispatching Release. Keep
  generation paused until compatible workers are confirmed. No production merge,
  mobile publication or backend deployment is performed by this preparation.
- Local backup was created by the owner on their computer. Its index was checked;
  nothing was uploaded/restored. Production SQL migrations were applied directly
  by the owner and independently verified; they did not reload the backup.
- Validation: nine release-guard cases passed, including rejected stale/missing
  revisions and non-main branches; shell syntax, all workflow YAML parsing and
  production/preview wiring checks passed. No application code changed; retain
  prior app test/export evidence. GitHub checks are verified at handoff.


### Version 1.9.0 production migration verification

- Owner reported generation paused and manually applied migrations 0011–0015
  in order through SQL Editor, each reporting success.
- Independently verified the original production project through a read-only
  session-pooler transaction: six new tables, RLS enabled with no client policies,
  four added columns, five indexes, foreign keys/checks, daily-review uniqueness,
  final revision-status constraint and published-lesson timestamp backfill.
- Record all five migrations only after that verification. No production writes
  were performed by this verification; migration files remain immutable.
- Local pre-release dump exists and its archive index is readable. Full restore
  remains untested; owner explicitly deferred the separate cloud Backup project.
- Backend/worker rollout and ordering before OTA remain outstanding. Keep
  generation paused and release #200 draft; do not merge main yet.
- Validation: migration file/ledger comparison and whitespace checks passed.
  No application code changed; application tests were not rerun for this entry.

### Version 1.9.0 release preparation

- Preparing the merged #197/#198 work for a `develop` to `main` release.
- Version 1.9.0 includes a matching one-time What's New card; native runtime
  stays at 1.3.0. Preserve the existing per-device dismissal behavior.
- Release must remain draft until production backup, generator pause and verified
  application of migrations 0011–0015 are complete. No production operations or
  ledger claims are included in this preparation.
- `6166d80` adds version/card together. Node 24 typecheck and all 39 tests
  passed; Android/iOS/web exports and whitespace checks passed. Physical-device
  checks remain outstanding. The release PR is intentionally draft pending the
  production rollout; its migration check will fail until verified application.


### PR #198 cursor review follow-up

- `b38fd15` fixes the confirmed History query mismatch (`before` vs backend
  `cursor`) in the same PR, with the browser fixture matching the real contract.
- Before the fix, the corrected fixture reproduced 50/120 records and a retry
  error instead of loading the next page. After the fix, all 120 records load.
- Validation: Node 24 typecheck, all 39 unit tests, web export and the corrected
  History browser test passed (paging, retry, offline restart/detail, sign-out
  and late responses). Whitespace checks passed. No backend changes; native
  gesture/device checks remain unverified as recorded below.

## Learning experience batch (#158, #159, #160)

- Implemented one PR from merged `develop` (`3937927`), branch
  `codex/learning-experience-polish`, isolated in `/tmp/one-concept-next`.
- Confirmed History still stopped at ten, refresh gestures were absent, and
  offline banner contrast was insufficient. Existing explicit retry screens
  were already present and remain available.
- `e2eed9b`: full History through the existing 50-item cursor API, explicit older
  page loading, search within loaded records, account-scoped page caching and
  sign-out cleanup. Startup remains compact; previously opened lesson bodies
  remain readable offline. `afa8e96`: high-contrast offline colors, wrapping
  profile identity and a compact detail header with a 44px close target.
- `feat: add deliberate refresh controls across learning screens`: shared native
  pull controls and accessible buttons, disabled during active refresh, preserving
  offline content and allowing explicit detail refresh to probe reconnection.
- Validation: Node 24 typecheck and **39 tests passed**, no skips; Android/iOS/web
  exports passed. Mocked browser checks passed for 120-item History, 503 retry,
  offline restart/pages/detail, explicit detail reconnection and in-flight sign-out;
  rejected-review replay in both themes; refresh busy state, offline content,
  banner contrast and 320px enlarged profile in both themes. Inspected screenshots.
  Banner contrast measured **9.93:1 light / 10.72:1 dark**. Local links and whitespace
  checked. Backend code and schema are unchanged; backend tests were not rerun.
- Browser footer activation was made deterministic with keyboard interaction
  after a scroll-timing flake; request tracing confirmed page boundaries and
  stale-response fencing. Temporary instrumentation was removed from the source.
- Native pull gestures, Dynamic Type, TalkBack/VoiceOver still need device checks.
  Search covers loaded History pages; older bodies require prior download.
  [PR #198](https://github.com/Coding-Moves/one-concept/pull/198) targets `develop`
  and closes the three issues when merged. No manual issue closure or release yet.
  Release preparation and its one-time What's New card follow the feature merge.

### PR #197 review correction

- Fixed rejected offline review replay in the same PR. Pre-completion statistics
  now survive restart; a terminal replay rejection restores the matching activity
  and its exact totals on disk before removing the queued intent. A failed refresh
  returns the corrected cache immediately. Newer activities and unrelated saves
  are preserved; sign-out keeps its existing write fence.
- The new `--reject-review` browser regression fails on the original export and
  passes on the fixed export in both themes, including failed refresh and restart.
  The normal successful replay browser scenario also passed in both themes.
- Validation: Node 24 typecheck, **37 tests passed with no skips**, web export,
  browser scenarios and `git diff --check`. Backend/native code is unchanged;
  backend tests and physical-device checks were not rerun for this JS-only fix.
- Focused implementation/test commit: `fix: roll back rejected offline reviews
  before removing queued intent`. Test instructions and this handoff are a
  separate documentation commit. No merge, release or production change.

## Sustainable learning (#195) — 2026-09-13

- Implemented all five lifecycle work areas in one feature PR targeting `develop`:
  durable reader-based refill; portable subject/curriculum imports; reviewed,
  versioned shared content; daily review with offline replay; protected operations.
  The existing five subjects remain; future addition/retirement uses data imports.
- Work is isolated in `/tmp/one-concept-195`, branch
  `codex/195-sustainable-learning`, based on `develop` (`3cc5af3`). The original
  handbook checkout and its unrelated edits remain untouched. Expo SDK 57 docs
  were read before mobile work. No app version/runtime change was made.
- Reproduced the 25-lesson refill ceiling with actual selection/prefetch against
  disposable PostgreSQL and mocked drafting. The regression now passes. Review
  also caught and fixed a worker wake before its durable target committed.
- Commits: `e0eb494` architecture scope; `11adafc` refill; `1a106c0` curriculum;
  `72e3a9b` editorial gate; `c5d305e` review API/streaks; `ebf4c28` review outbox;
  `9bc36a8` operations; `49ad80f` generation concurrency/recovery;
  `64285a4` selection consistency; `bd166ed` cache cleanup; `5a569b0` review UI;
  `465a47a` year simulation/restore. Further preservation/handoff commits are
  identified by their subjects; preserve every meaningful commit when merging.
- Validation: full backend suite **171 passed, no skips**, using disposable
  PostgreSQL 16 with live HTTP blocked. Added legacy-snapshot regression afterward:
  publication suite **4 passed** (172 backend tests now collected). The yearly
  simulation covers three readers, five subjects, queue extension and a prolonged
  drafting outage; each reader reaches 365 learning days without inflating unique
  learned totals. Backup dump/restore passed in a second disposable database.
- Mobile: Node 24 typecheck and **36 tests passed, no skips**; Android/iOS/web
  exports passed. Mocked browser checks passed in both themes, narrow/enlarged
  text, review offline restart/reconnect, future-subject exploration, timer replay,
  transient failure, in-flight sign-out and all 365 saved bodies. Inspected review
  screenshots. Physical-device font scaling, screen readers, native storage and
  real two-device acceptance remain manual; backend concurrency tests cover races.
- Read-only production classification found 26 old failures: 18 throttling,
  four validation, four unclassified. None was retried/reset. No production writes,
  model generation, scheduler configuration or deployment occurred. Migrations
  0011–0015 remain intentionally absent from the applied ledger; apply/verify them
  before backend rollout, then deliver the JS update. Pause old generation workers
  during migration/deployment so they cannot bypass the editorial gate.
- Architecture and operating procedures: [CONTENT_ARCHITECTURE.md](CONTENT_ARCHITECTURE.md)
  and [CONTENT_OPERATIONS.md](CONTENT_OPERATIONS.md). Human curriculum expansion
  and source review are required; title-similarity checks do not prove originality.
  Operational transitions appear in protected job output, with no external alerts
  configured. Production backup/Auth restore remains a separate live rehearsal.
- [PR #197](https://github.com/Coding-Moves/one-concept/pull/197) is open for review
  from `codex/195-sustainable-learning` into `develop`, with the full architecture,
  validation and rollout detail. Local documentation links and whitespace checks
  passed. No merge or production release was performed. The final bookkeeping
  commit is `docs: record sustainable learning PR handoff`. Merged the latest
  documentation-only `develop` (`88eb2de`) afterward, preserving both handbook
  and feature log entries; no application code changed during conflict resolution.

## App engineering handbook — 2026-09-13

- **Outcome:** create a complete printable PDF explaining the app from beginner
  to advanced level, with layer diagrams, daily selection examples, catalog
  exhaustion/refill, notifications, email, credentials by purpose, release flow,
  tradeoffs, and a seven-day study digest.
- **Scope:** documentation and a reproducible PDF source only; no application,
  production configuration, content generation, or messaging changes.
- **Branch/base:** `codex/app-engineering-handbook` from freshly fetched
  `origin/develop` at `3cc5af3`. GitHub read-only checks confirm #191 and #193
  merged; `main` is `2e537f6`. Older release status below is historical.
- **Planned commits:** scope; source-based handbook; PDF builder and navigation;
  validation and PR handoff. Generated PDFs/previews remain untracked outputs.
- **Evidence:** inspect current implementation before prose, verify relevant
  provider documentation, distinguish code/defaults from live service settings,
  and omit credential values. Render and inspect every final PDF page.
- **Scope addition:** the owner requested discussion of future issue #195 and
  concluding before/after Q&A. Read the open issue and its dated production
  inventory; explain its five proposed work areas, benefits, tradeoffs and
  undecided parameters. This is design documentation, not authorization to
  implement #195, generate content, change production or close that issue.
- **Delivered:** a 49-page handbook with 47 chapters and 29 vector diagrams,
  clickable contents/bookmarks, pinned source links, credential names/purposes
  without values, a seven-day study guide, and final before/after Q&A. Current
  refill behavior is distinguished from the proposed sustainable design in #195.
  Reproducible source and build instructions are in `docs/handbook/`; the local
  output is `output/pdf/one-concept-engineering-handbook.pdf` (ignored by Git).
- **Commits:** `d04df36` records scope; `15fd0a3` explains the current app;
  `159b564` adds the #195 comparison and Q&A; `eff0673` adds the PDF renderer,
  diagrams, build guide and navigation. This validation entry is committed as
  `docs: record handbook validation and handoff`.
- **Validation (passed):** rebuilt and rendered all 49 pages with Poppler;
  visually reviewed every page and individually rechecked revised diagrams.
  Final automated checks confirm 29 figures, 291 link annotations, 176 valid
  local source-path references, correct chapter order, text within page bounds,
  valid build-script syntax and no secret-looking token patterns. README local
  links and `git diff --check` pass. Minimum body/table fonts are 9.13/8.1 pt.
- **Limits / not run:** application tests were not rerun for documentation/layout
  work. Live database contents, actual cron/SMTP settings, inbox delivery and
  physical-device push delivery were not tested. The handbook labels historical
  test evidence, dated issue inventory and future-design decisions explicitly.
- **Handoff:** [PR #196](https://github.com/Coding-Moves/one-concept/pull/196)
  targets `develop` with the focused commits above plus validation `6df5ffc`.
  Preserve the commits; #195 remains open for its separate implementation.
  The PDF is delivered locally and the PR provides its reproducible source.
  Another task's appended issue-creation note remains unstaged and preserved.
- **Publication:** the initial automatic-review destination concern was resolved
  by verifying the existing public origin, owner ADMIN access and public-source
  scope without credential values. The approved push used the existing GitHub
  credential helper after plain HTTPS authentication was unavailable. No merge,
  deployment or production mutation was performed.

## Previous release handoff (historical)

- [Release PR #191](https://github.com/Coding-Moves/one-concept/pull/191) is open
  from **develop → main** for **1.8.0**, with the six-benefit one-time card and
  runtime **1.3.0**. Feature/fix PRs #183–#186, #188, and #189 are included;
  preparation #190 and release bookkeeping #192 are merged.
- The owner explicitly approved applying migration 0010 to production after
  the earlier automatic-approval rejections. The exact migration is now applied
  and its committed schema was independently verified. The ledger entry was
  added only afterward, in `01a532e`.
- [Fix PR #193](https://github.com/Coding-Moves/one-concept/pull/193) brings the
  verified ledger and handoff into `develop`, updating release #191. Confirm its
  merge and the release's latest required check on GitHub before production merge.
  The unchanged migration workflow passes locally for all ten migrations.
- No production app release was merged or deployed in this follow-up. The shared
  generation-budget first-day rollout and consistent API/worker caps still need
  the release-time handling documented in `backend/README.md`.
- Resend setup remains deferred in [draft PR #187](https://github.com/Coding-Moves/one-concept/pull/187).
  The owner reports installing all three merged email templates and enabling the
  password-change notification in Supabase; actual inbox delivery is unverified.

## Release migration check follow-up — 2026-09-13

- **Problem:** both failed runs on #191 reported only
  `0010_generation_daily_usage.sql`; the latest preview OTA passed. Read-only
  production inspection confirmed the table was absent, so adding an unverified
  ledger entry or weakening CI would not fix the deployment prerequisite.
- **Authorization:** automatic review initially rejected the production mutation.
  The owner then explicitly approved the exact migration, verification, and PR
  update. Previous blocked attempts did not run SQL.
- **Application:** executed the unchanged migration against the configured One
  Concept production Supabase database using its validated session connection.
  It creates only `public.generation_daily_usage` and enables RLS; existing tables
  and rows are unchanged. The initial helper's post-commit assertion failed;
  no retry of the migration was performed. A separate read-only connection
  verified the committed schema with explicit text casts for constraint kinds.
- **Verification:** `budget_day` is a nonnullable date primary key; `calls_used`
  is a nonnullable integer defaulting to zero with a nonnegative check. RLS is
  enabled and no client policies exist. Recorded the migration only after all
  these assertions passed. No test data was inserted into production.
- **Commits:** `df377b0` records scope; `402f520` records the previous authorization
  blocker; `01a532e` records verified production application in the ledger;
  `docs: record verified release migration and handoff` records the result and
  updates the codebase map. Preserve all commits in #193.
- **Checks:** the unchanged CI shell check passes locally; all ten SQL filenames
  are recorded with no unknown ledger entries. Migration SQL and workflow are
  unchanged. Reviewed staged changes and checked whitespace/local documentation
  paths. No application tests were rerun for this ledger/documentation follow-up;
  the release's prior 145 backend tests used this same SQL on disposable
  PostgreSQL 16 and passed without skips.
- **Handoff:** merge #193 into `develop`, confirm the required migration check on
  #191, and update that release's checklist with the verified application. GitHub
  records the resulting merge/check state. Release merging remains with the owner.

## Version 1.8.0 preparation — 2026-09-13

- **Scope:** wind up merged work and open the release PR with its required
  version-matched, one-time What's New card. Keep original focused commits and
  leave production release merging to the owner.
- **Highlights:** downloaded saved lessons/examples offline; automatic action
  synchronization on reconnect/reopen; persistent offline topic choices; lighter
  startup and older Saved search/filter access; password visibility; clearer
  account emails. The deferred SMTP-provider draft is excluded.
- **Card:** allow the highlight list to scroll while the heading and Got it stay
  visible. Keep the existing device/version dismissal key and sign-in gating.
  The browser regression checks the actual exported version, both themes at
  320×568, 390×844, and 844×390, the last highlight, and offline restart after
  dismissal. No native dependency or runtime change is needed.
- **Commits:** `d087182` records scope; `e846760` makes long release cards readable
  with regression coverage; `1e92332` sets version 1.8.0 and its six highlights.
  `docs: record 1.8.0 release validation and migration prerequisite` records the
  test instructions, map, and this handoff.
- **Validation:** all **145 backend tests passed, no skips**, using disposable
  PostgreSQL 16 and dummy Auth configuration with generation disabled. TypeScript
  and all **33 Node 24 tests passed, no skips**. Android and web production exports
  passed with dummy public configuration. The new card browser scenario passed
  all six viewport/theme combinations and dismissal across offline restart;
  screenshots were inspected. An initial web export retained the old Expo config
  version in Metro's cache; rebuilding with `--clear` resolved it. No application
  code workaround was needed. Artifacts remain under `/tmp/one-concept-1-8-*`.
- **Limits:** physical-device/native accessibility checks and actual inbox
  delivery were not exercised. This release reran backend/unit/card checks;
  #189's documented password and full offline-collection acceptance checks remain
  the coverage for those unchanged flows.
- **Database prerequisite at preparation:** production initially lacked the
  usage table and automatic approval blocked applying it. Resolved after the
  owner's explicit approval in the migration-check follow-up above; #193 records
  verified production application.
- **Deployment handoff:** the shared generation-budget rollout in
  [backend/README.md](../backend/README.md#shared-generation-budget) still
  requires consistent caps across API/workers and pausing old generators during
  rollout. Enable the new generators at the next Pacific reset, or seed today's
  usage conservatively while paused. No live worker settings were changed.
- **PRs:** preparation [#190](https://github.com/Coding-Moves/one-concept/pull/190)
  merged into `develop` as `fa2b7a7`, preserving all five commits. Release
  [#191](https://github.com/Coding-Moves/one-concept/pull/191) is open from
  `develop` to `main` at the owner's explicit request to open it now. The release
  description initially marked migration 0010 and generation rollout as pending.
  `docs: record 1.8.0 release PR handoff` records this outcome.
- **Next step:** require the latest migration check to pass after #193 lands
  before production merge. Opening #191 did not itself apply the migration or
  publish a production release.

## Saved reading offline and password visibility (#182) — 2026-09-12

- Read the exact Expo SDK 57 and React Native 0.86 input/Pressable documentation.
  Compared fresh `develop` with production `main` and inspected both issue images.
  Production still fetches full lessons only from the API; `develop` already
  persists/downloads saved bodies through the earlier #133/#150 changes.
- Reproduced the missing eye button in an unchanged web export: the new browser
  test failed at Show password. The existing 365-item offline scenario passed
  before editing, so no duplicate cache implementation or new native storage
  dependency was needed. Lessons must download online once before offline use.
- Added an eye button with changing Show/Hide password accessibility labels and
  a 48px minimum target. It preserves typed values/autofill hints, disables
  correction, and masks again on sign-in/signup submission and mode changes.
  The field/control disable during requests. Visibility is not persisted.
- **Validation:** TypeScript and all 33 Node 24 tests passed, with no skips.
  Web and Android production exports succeeded with dummy configuration.
  The password browser regression passed both themes, keyboard activation,
  value/submission preservation, busy state, signup confirmation, remasking,
  and 320/390/960px targets/overflow. An initial harness assertion expected an
  explicit HTML text type; corrected it to check the input's effective type.
- Both final offline browser scenarios passed: large collections and timer-only
  reconnect with a replay error/sign-out in flight. Verified all 365 explanations
  and examples on disk after restart, unopened older/read saved bodies in the UI,
  search/filter, retry, pending unsaves, offline save, and cache cleanup. No browser
  runtime errors. Inspected light/dark auth and offline lesson screenshots.
- Artifacts stay under `/tmp/one-concept-182-*`. No live account, email, backend,
  or production service was used. Native keyboard/autofill, screen readers, and
  on-device storage were not exercised; preview checks remain in
  `mobile/tests/README.md`. Backend tests were not run for this mobile-only change.
- Commits: `b76fecd` records scope; `2e41289` adds the UI and browser regression;
  `18fb94b` strengthens offline acceptance; `eef0ea4` records the map, test
  instructions, and handoff. `docs: link password and saved reading PR` records
  [PR #189](https://github.com/Coding-Moves/one-concept/pull/189), non-draft into
  `develop`, with five focused commits. Version/runtime are unchanged; this
  chunk does not open or merge a release PR.

## Separate branded email templates — 2026-09-12

- Owner requested the three templates in a separate non-draft PR, allowing
  branding to merge while domain/provider setup stays deferred. Rechecked
  Supabase documentation: customizing templates does not remove the built-in
  sender's team-only/two-emails-per-hour restrictions. Existing configured
  Gmail SMTP can be used separately once authenticated and tested.
- Preserved nine original template commits from #187, in order, covering signup,
  recovery, copy/spacing improvements, the dark text masthead, the Coding Moves
  organization link, and the password-changed notification. Sources are byte for
  byte identical to the previously validated versions. The owner selected text
  branding; no custom app logo was available.
- Added `docs/EMAIL_TEMPLATES.md` with exact subjects, manual installation,
  confirmation placeholders, the security toggle, existing redirect contract,
  and activation checks. The guide does not require domain purchase or Resend.
- **Validation:** the unchanged HTML previously passed 60 Chromium scenarios:
  48 for signup/recovery and 12 for password changed, across four widths and
  normal/doubled/stripped styles, plus normal/long verification URLs. Those checks
  covered links, fallback URLs, styled overflow, spacing, action sizes, and no
  external resources; mobile/desktop/enlarged previews were inspected. For this
  split, verified byte equality with `b0695ca`, inspected app redirect/support
  source, checked local Markdown paths/anchors, and ran `git diff --check`.
  Browser scenarios were not repeated for identical HTML. Backend/mobile and
  live-email tests were not run for this HTML/documentation-only change.
- Commits: `245b7f6` records scope; `d88f432` through `50d065d` preserve the nine
  template changes; `4ccba83` adds installation/navigation docs; this handoff is
  `docs: record independent email template PR and validation`.
- **Handoff:** merge #188 independently of #187. Then install/test templates in
  Supabase before announcing the changed emails. Merging/releasing the app does
  not synchronize templates or enable security notifications. Delivery issues
  #152/#171 stay open for the remaining operational work; no release PR opened.

## Shared generation budget (#151) — 2026-09-12

- Confirmed both gaps before implementation against the same generation source
  now on `develop`: with a zero configured cap, actual prefetch/pool control flow
  reached the mocked generator five times; two scheduled runs capped at two each
  made four calls total. Database/provider boundaries were mocked, with no live
  services or keys. The existing counter resets per run; prefetch never reads it.
- Use one database reservation per attempted provider call, committed before the
  network request. Budget denial must roll back the backlog claim without burning
  an attempt. Once reserved, failed/throttled/uncertain calls still consume budget;
  preserve the separate backlog retry refund for rate limits.
- Align the budget day with Gemini's documented midnight Pacific reset, computed
  by PostgreSQL in `America/Los_Angeles`, independently of user progress timezones.
  [Provider documentation](https://ai.google.dev/gemini-api/docs/rate-limits).
- Inspection also found the manual catalog rewriter calls the same provider;
  include it in the shared budget rather than leaving another bypass. No catalog
  rewrite will actually be run against production.
- Intended commits: scope/reproduction; counter migration/service/concurrency
  tests; backlog/scheduled enforcement/tests; prefetch integration/tests; rewrite
  enforcement/tests; operational documentation/validation; PR bookkeeping.

- Added migration `0010_generation_daily_usage.sql`, an ORM mirror, and a backend-
  only ledger with an atomic UPSERT. A new Pacific budget date gets a new row;
  no reset job or process memory is involved. All services must use the same cap.
- Before pool integration, the new PostgreSQL regression reproduced two scheduled
  runs each spending two calls under a cap of two (expected second run: zero).
  After integration it passes. The prefetch zero-cap test now makes zero calls,
  and simultaneous scheduled/prefetch runs share their remaining slots.
- Quota reservation and backlog claim commit together before the provider call,
  releasing the connection. Denial or a failed commit rolls the claim back. Empty
  backlog spends nothing; committed failed/throttled/cancelled attempts retain
  quota. Separate backlog rate-limit refunds and retry retirement remain intact.
- Catalog rewrites use the same reservation gate, honor generation/key switches,
  retain old content when stopped, and dispose their engine on every exit. The
  maintenance command was exercised only with a disposable DB and mocked provider.
- **Validation:** all 145 backend tests passed against PostgreSQL 16 (no skips),
  including 33 new cases across the counter and generation-path suites. Ruff
  (`F,E9`), whitespace, and documentation link checks passed. Twenty concurrent
  reservations with cap three admit exactly three; twelve concurrent backlog
  generations also admit three unique publications without extra spent attempts.
  Coverage includes independent sessions/reruns, Pacific winter/summer midnight,
  cap changes/zero/negative values, RLS denial for client roles, empty backlog,
  committed-before-provider checks, DB/commit failures, provider failures and
  cancellation, switches, rate-limit refunds, and cross-path competition.
- **Deployment limits:** production DDL, migration-ledger updates, paid calls,
  live provider quota checks, and deployment were not performed. Mobile tests
  were not run because no mobile code changed. The ledger starts empty and cannot
  reconstruct old calls: pause old generators during rollout, then enable at the
  next budget reset or seed today's usage conservatively. Other applications'
  Gemini usage is outside this application ledger; provider limits still apply.
- Commits: `92d537f` scope/reproduction; `91f70ba` ledger/migration/tests;
  `b8eabdc` claim/scheduled enforcement/tests; `2b199da` prefetch integration/tests;
  `e39df10` rewrite enforcement/tests; `2baec95` operational documentation and
  validation.
- **PR:** [#186](https://github.com/Coding-Moves/one-concept/pull/186), open into
  `develop` with individual commits and owner authorship. Publication bookkeeping:
  `docs: link shared generation budget pull request`. Ready for review; merging,
  production migration application, and deployment were not performed.

## Bounded startup state (#150) — 2026-09-12

- Read the exact Expo SDK 57 documentation before mobile edits.
- Confirmed before implementation with disposable PostgreSQL 16 and 365 completed
  and saved concepts: both the existing request and `?compact=true` returned all
  365 detail rows in each list, about 151 KB. The new regression failed at the
  expected 50-row limit. No production service was used.
- Keep legacy state responses for older clients during backend/OTA rollout. The
  updated client will request compact metadata, retain exact aggregate totals,
  and load older Saved metadata in pages when needed. Full History UI is separate.

- Delivered opt-in compact state on GET state, PUT topics, and PATCH profile;
  updated mobile requests use it. Both cursor endpoints default to 50 and allow
  1–100 items. Like counts are enriched after limiting rows; full membership and
  streak/aggregate work still grow with activity. Saved timestamp/UUID ordering
  handles ties and deletion between pages, with all queries scoped to the JWT user.
- Stats combines older-topic aggregates with recent/optimistic learned rows.
  Saved paints recent/cached rows, then loads older metadata in bounded pages;
  previously downloaded bodies provide older titles offline even before the first
  Saved visit. The new account-keyed cache clears at sign-out and fences late pages.
- Final review reproduced a manual Retry that sent no request after connectivity
  returned. Fixed it in a follow-up commit and retained the failing-before/passing-
  after browser scenario. Equivalent state refreshes do not spin failed page loads.
- **Validation:** all 112 backend tests passed against disposable PostgreSQL 16,
  with no skips; 33 Node 24 tests, TypeScript, Ruff (`F,E9`), and whitespace checks
  passed. Android/web production exports succeeded using dummy configuration.
  The first restricted export stalled; it was stopped and completed with local
  worker communication enabled. Documentation links/new source paths were checked.
- The 365-record PostgreSQL fixture returned 151,007 bytes through the legacy
  contract and 55,676 bytes through compact state, about 63% smaller, with exactly
  50 learned and 50 saved details. Pagination recovered all 365 without duplicates.
  Tests cover limits/invalid cursors, user isolation, exact window boundaries,
  mutations, tied saves, deletion between pages, own-like exclusion, and totals.
- Browser coverage passed for the 365-item account: full Stats/category totals,
  older Saved search/category filters and reading, offline restart before Saved
  was ever opened, page failure/retry without a request loop, manual reconnect
  retry, offline completion/unsave, and sign-out during a pending successful page.
  Inspected the mobile-sized search screenshot. Existing timer-only sync, 503
  replay recovery, saved-body/topic persistence, midnight save, and partial-
  connectivity recovery scenarios also passed without browser runtime errors.
- **Limits:** no physical-device run or production benchmark/deployment. Android
  validation is a JS export, not a new APK. Old clients keep the unbounded legacy
  response until OTA adoption; membership arrays remain complete. Saved still
  downloads all older metadata when opened to preserve full search, and offline
  full text requires its completed body download. Pagination is a live view;
  refresh startup state for new rows above an existing cursor.
- Commits: `64afb6d` scope/reproduction; `09f4b22` future commit preference;
  `ce38299` backend contract/endpoints/tests; `32cc70a` Stats compatibility/tests;
  `b62ab19` Saved paging/cache/browser checks; `50b7f88` compact request activation;
  `2d83b7a` manual reconnect retry. Documentation handoff:
  `docs: document compact state rollout and validation` (`730a28d`).
- **PR:** [#185](https://github.com/Coding-Moves/one-concept/pull/185), open into
  `develop` with individual commits and owner authorship. Publication bookkeeping:
  `docs: link bounded startup pull request`. Ready for owner review; merging and
  deployment were not performed. Disposable browser/database checks finished.

## Database connections after idle (#149) — 2026-09-12

- Reproduced before implementation using the unchanged app engine/session and
  a disposable PostgreSQL 16 container on loopback port 55434. Set the test
  server's idle-session timeout to 1.5 seconds, then waited two seconds between
  requests. SQLAlchemy connection events confirm all three post-idle requests
  created a new physical connection: 260.23, 221.45, and 220.35 ms. Immediate
  reuse took 10.91, 10.24, and 9.40 ms with zero new connections.
- This reproduces the request-time reconnect mechanism under controlled idle
  expiry, not Supavisor's deployed timeout or the issue's production 600 ms figure.
- Intended fix: configurable, bounded probes in the FastAPI lifespan, reusing
  the most recently returned connection. Keep `pool_pre_ping`, transaction-mode
  configuration, and current connection limits. Cancel probes before pool disposal.
- Planned commits: reproduction/scope; warm connection lifecycle with regression
  tests; measured validation, operational instructions, and PR handoff.
- Implemented an immediate then periodic API lifespan probe (30-second default,
  zero to disable), reusing the most recently returned pool connection. Checkout/
  query and rollback/return each have a five-second default budget. Failures retry
  after the interval; logs omit raw connection details. Shutdown waits for cleanup,
  including when cleanup itself fails. The task does not start in cron workers.
- A real-PostgreSQL test caught cancellation returning before SQLAlchemy finished
  connection cleanup. Fixed it before handoff and added failure/cancellation coverage.
- **Validation:** all 105 backend tests passed, with real PostgreSQL 16 integration
  coverage and no skips. Ruff (`F,E9`) and whitespace checks passed. The final
  controlled comparison (800 ms test-session idle timeout, 1.2-second gaps) was:

  | Warm-up | Three request times (ms) | New physical connections |
  | --- | --- | --- |
  | Disabled | 223.98, 209.61, 234.05 | 3 |
  | Enabled, 200 ms test interval | 7.93, 8.18, 8.29 | 0 |

  Both cases use the same engine factory, query, and disposable database. Timings
  are reported rather than asserted; connection counts are the regression check.
  Covered query/checkout/cleanup timeouts, recovery, cancellation, transaction
  release, terminated connections, disabled probes, and lifespan failures.
- **Limits:** no live Supabase/Railway measurement, production deployment, mobile
  test, or native build. The issue's deployed timeout/600 ms figure remains
  unverified. Cold startup and additional connections during bursts can still pay
  setup cost. Each API process adds a periodic probe with the configured interval.
- Commits: `50d73ab` — reproduction and scope; `6bf0399` — implementation/tests;
  `679163a` — validation and operational documentation.
- **PR:** [#184](https://github.com/Coding-Moves/one-concept/pull/184), open into
  `develop` with all individual commits and the owner's configured identity.
  Publication bookkeeping: `docs: link database warm-up pull request`.
  Disposable reproduction/test containers were removed. Ready for owner review;
  merging and deployment were not performed.

## PR #183 review fixes — 2026-09-12

- Owner requested both findings fixed in the existing PR against `develop`.
  Planned and delivered one fix/test commit per finding, followed by this
  documentation handoff. Read the exact Expo SDK 57 documentation before edits.
- Reproduced both problems before editing: a save waiting behind a like across
  midnight never persisted (the unchanged `develop` control succeeded); successful
  state requests followed by failed topics requests caused rapid repeated fetches.
  The new committed browser scenarios fail on the previous PR export.
- `d9a07f5` — `fix: preserve pending actions across midnight`: split account
  invalidation from daily refresh, preserve pending counts, and prevent cached
  previews from overwriting pending optimistic actions. Browser coverage checks
  queued save persistence through date change, offline restart, and replay.
- `409b1af` — `fix: retain backoff after partial sync failures`: failed attempts
  retain backoff even when their own requests report connectivity changes.
  Tests cover the full 5/10/20/30-second progression, immediate reconnect while
  waiting, coalesced successful wakeups, and automatic recovery in the browser.
- **Validation:** 31 Node 24 tests, TypeScript, Android/web production exports,
  and whitespace checks passed. Both new browser scenarios and the full offline
  flow passed, including timer-only reconnect, 503 recovery, offline save restart,
  and sign-out with an in-flight request. No browser runtime errors. No backend
  changes; backend tests, live services, and physical-device checks were not run.
- **Handoff:** both fixes stay in [PR #183](https://github.com/Coding-Moves/one-concept/pull/183)
  on `codex/133-offline-reading-sync`. Native runtime, version, and dependencies
  are unchanged. Documentation commit: `docs: record PR 183 review fixes`.

## Offline reading and synchronization (#133) — 2026-09-12

- Before editing, exported the unchanged web app and exercised it in Chromium
  with dummy authentication and intercepted API requests. No live account used.
- Confirmed: a custom saved concept opened online loses its full text after an
  offline restart; a warmed topic catalog is unavailable after offline restart;
  offline topic changes do not enter the persistent queue; restoring connectivity
  alone leaves an offline like queued without sending a request.
- Passing controls: saved detail online, cached Today offline, and durable offline
  like queuing. Preserve those existing behaviors and the offline banner.
- Planned atomic commits: persistent full-concept reading with account cleanup
  and tests; cached topic catalog and queued follows with tests; automatic sync
  triggers with tests; validation, codebase map, and PR handoff.
- Owner chose to keep the current APK: automatically retry while the app is open
  or reopened. No OS background worker, native dependency, or version/runtime bump.
- Read the exact Expo SDK 57 documentation before mobile edits. Other issues,
  including #182's password-visibility request, remain outside this PR.
- Additional replay checks reproduced two related failures before their fixes:
  a 503 reverted a queued unlike in the UI; a request failing after sign-out
  recreated the old action queue. Preserve pending choices during reconciliation
  and fence late request callbacks/token resolution after account cleanup.
- Implemented full per-lesson storage and missing saved-lesson downloads;
  shared cached topics with durable follows; serialized outbox writes; automatic
  foreground retry with 5–30 second backoff, immediate browser/foreground wakeup,
  and no idle polling once reachable with an empty queue. Saved reading requires
  the lesson to have finished downloading during an online session.
- **Validation:** all 28 Node 24 regression tests, TypeScript, Android/web Expo
  production exports, and whitespace checks passed. The mocked Chromium flow
  passed offline restart, unopened saved-lesson downloads, cached sharing, follows,
  likes/saves, timer-only and browser-event reconnect, 503 retention/recovery,
  and sign-out with a request in flight. Inspected the offline detail screenshot.
  No live backend, physical phone, native share sheet, or production deployment
  was tested; no backend code changed and backend tests were not run.
- **Repeatability:** `mobile/tests/offline.browser.cjs` and its README retain the
  before/after reproduction flow, dummy public configuration, and optional race
  checks. New focused Node tests cover storage, outbox, topics, reconciliation,
  and scheduler behavior without adding dependencies.

| Change | Commit |
| --- | --- |
| Baseline reproduction and scope | `0e82f03` |
| Full offline lesson storage and saved downloads | `0085285` |
| Cached topics and queued follow choices | `41da1ab` |
| Serialized durable outbox | `f8d1ca6` |
| Automatic foreground synchronization | `1a82c2e` |
| Preserve pending choices during reconciliation | `cfa24ea` |
| Sign-out request fence and browser regression | `d19e1fe` |
| Validation and navigation guide | `docs: record issue 133 validation and handoff` |

- **PR:** [#183](https://github.com/Coding-Moves/one-concept/pull/183), opened
  into `develop` with all individual commits and the owner's configured identity.
  Publication bookkeeping: `docs: link issue 133 pull request`.
- **Handoff:** ready for owner review. The PR remains open; merging and release
  preparation are the owner's next steps, outside this task.

## Working agreement — 2026-09-11

Work in chunks delivered through PRs. Every small, meaningful change gets its
own commit, and the PR retains all commits for that chunk. Prefer the maximum
useful granularity, without empty commits or artificially broken changes.
No numeric commit cap was specified. Preserve history instead of squashing it.

Authorship follow-up: the owner requests credit for their work with no Codex
co-author or AI attribution. The configured Git identity is `Muawiya Amir`;
the setup commits use that identity for author and committer, with no co-author
trailers. Preserve the configured owner identity for future work.

The agent handles planning, implementation, review, and bookkeeping. These are
responsibilities, not a request to launch additional agents.

## Setup record — 2026-09-11

### Starting point

- Clean working tree on `docs/source-available-policy` at `ba67edf`.
- Cached `origin/develop` is `5a2f957`, which includes that branch's changes.
  Its tree matches the inspected checkout. Local `develop` is older.
- Repository refs were inspected locally; remote branch state was not refreshed.
- Existing `mobile/AGENTS.md` and `mobile/CLAUDE.md` are preserved.

### Changes and commit ledger

| Change | Commit |
| --- | --- |
| Root instructions, PR/commit rules, responsibilities, validation guidance | `25c7540` — `docs: define agent workflow and granular commit rules` |
| Codebase map covering mobile, backend, schema, tests, and operations | `f6aec01` — `docs: map application architecture and development paths` |
| Durable setup record, validation baseline, and future chunk template | `fb5ccdb` — `docs: initialize project work log` |
| Owner authorship and no AI attribution rule | `5a25b7e` — `docs: record owner authorship and no AI attribution` |
| Setup PR link and publication handoff | `4cc1a68` — `docs: record setup pull request` |

### Exploration and decisions

- Inspected the tracked structure, application entry points, API/service/state
  boundaries, screens and components, auth and offline paths, schema/migrations,
  test coverage, dependency/configuration files, release docs, and workflows.
- Captured source-based documentation drift in `CODEBASE_MAP.md`; no feature,
  bug-fix, dependency, migration, or release work is part of this setup chunk.
- Root `AGENTS.md` holds shared rules; the existing mobile file retains its
  specialized Expo requirement. This follows the documented
  [AGENTS.md layering model](https://learn.chatgpt.com/docs/agent-configuration/agents-md).

### Validation baseline

| Check | Result |
| --- | --- |
| `npm run typecheck` in `mobile/` | Passed (`tsc --noEmit`). |
| `.venv/bin/python -m pytest -q -rs` in `backend/` with dummy DB/Auth environment overrides and live generation disabled | 27 passed, 66 skipped; no test failures. |
| PostgreSQL integration tests | Not exercised: Podman cannot create `/run/user/1000/libpod` in this sandbox (read-only filesystem). Skips are not passing integration coverage. |
| Documentation links, scope, and whitespace | Local links verified; changes limited to these three Markdown files; whitespace checks passed. |

No deployed API, physical device, push delivery, native build, or production
database was tested. The files changed in this chunk are documentation only.

### PR publication — 2026-09-11

- Refreshed `origin/develop` and checked the complete branch diff before pushing.
- Opened [PR #176](https://github.com/Coding-Moves/one-concept/pull/176) from
  `codex/project-bookkeeping` into `develop` using the owner's `Muawiya-contact`
  GitHub account. All four original setup commits are preserved.
- Added this bookkeeping update as a separate follow-up commit. The PR records
  the existing validation baseline and its PostgreSQL integration-test limitation.

### Next step

The setup PR was subsequently merged. The owner's next task is recorded below.

## Bot PR review — 2026-09-12

The owner requested individual review, approval, and merging of all open bot PRs.
The initial inventory contained #172, #173, and #174, all targeting `develop`.
No PR CI checks were attached, so validation used an isolated checkout with
dummy public configuration and no live backend or production credentials.

| PR | Finding and disposition |
| --- | --- |
| [#172 — React DOM 19.2.8](https://github.com/Coding-Moves/one-concept/pull/172) | Standalone `npm ci` failed with ERESOLVE because React remained 19.2.3. Initial changes-requested review recorded. Resolved by incorporating #173 so React and React DOM update together. |
| [#173 — React 19.2.8](https://github.com/Coding-Moves/one-concept/pull/173) | Standalone renderer smoke check threw an exact-version mismatch with React DOM 19.2.3. Initial changes-requested review recorded. Approval applies to the validated pair incorporated in #172, not a standalone merge. |
| [#174 — TypeScript 7.0.2](https://github.com/Coding-Moves/one-concept/pull/174) | Clean install, typecheck, and Android/web exports passed against current develop. Approved and merged as `71cf7fe`; its preview OTA workflow also passed. |

### React integration and validation

- Preserved both original dependency commits and refreshed current `develop`
  into the React DOM branch. Resolved adjacent manifest/lockfile edits by setting
  both React and React DOM to `19.2.8`; no other dependency changes were introduced.
- Dependabot rebased #173 during review. Rebuilt the pair using its updated head
  `195b48a` and verified that both package files were byte-identical to the tested
  candidate. Integration merge commit: `62d54cc`.
- Clean `npm ci --ignore-scripts --no-audit --no-fund`, `npm run typecheck`, and
  server-renderer smoke test passed for the pair with TypeScript 7.0.2.
- Expo production exports for Android and web passed. The renderer smoke test
  returned `<div>One Concept</div>` with React and React DOM both at 19.2.8.
- Expo SDK 57's bundled recommendations still list React/React DOM 19.2.3;
  these are tested patch updates within the allowed Dependabot patch policy.
  A physical-device test was not performed. Native runtime and app version were
  unchanged; this is a dependency maintenance update, not a production release.
- Decision: approve each React PR in the context of the tested pair and merge
  #172 into `develop` once both heads are verified. #173's head is included in
  that integration, avoiding a broken intermediate preview OTA.
- Bookkeeping commit: `docs: record bot dependency reviews` (this commit).

### Handoff

Verify the GitHub merge states and resulting preview OTA, then notify the owner.
Use PR #172's live status for the final integrated result. No `develop` to `main`
release is included in this task.

## Offline UI recovery — 2026-09-12

- **Issues:** [#166](https://github.com/Coding-Moves/one-concept/issues/166)
  (animated offline empty pages) and
  [#167](https://github.com/Coding-Moves/one-concept/issues/167)
  (weak connections cause sign-in prompts and raw network errors).
- **Scope:** preserve cached browsing during session refresh; present friendly
  authentication errors; reuse an animated, accessible empty state with retry
  on unavailable content. Preserve useful cached content and real empty states.
- **Planned commits:** session recovery and regression coverage; friendly auth
  transport/error handling; shared offline illustration; integrate screen retry
  states; record validation and PR handoff. Keep each meaningful change atomic.
- **Research:** read Expo SDK 57 docs, React Native Animated/AccessibilityInfo
  docs, and the installed Supabase refresh/storage implementation. Use built-in
  animation with reduced-motion support; no asset download or native dependency.
- **Release boundary:** keep app/runtime versions unchanged in this chunk. The
  later release preparation selects the version and includes a matching one-time
  What's New entry only for new features, per `RELEASING.md`.
- **Commits:** `db1c59e` records scope; `4bed52a` restores cached sessions;
  `53f2e1a` adds safe auth messages and bounded requests; `67643d6` adds the
  reusable animation; `22fbcef` integrates retry and offline states on six screens.
- **Validation:** clean dependency install, 10 Node regression tests,
  TypeScript checks, and Android/web production exports passed. Browser checks
  used dummy accounts and intercepted requests: expired-session cached browsing
  and offline states in Today, History, Saved, Stats, and Personalization were
  verified, including the light-theme layout and successful topic retry.
  No live backend, physical device, or native release was tested.
- **Documentation:** updated the codebase map and test instructions. Bookkeeping
  and handoff are recorded in `docs: record offline UI validation and handoff`.
- **Next step:** owner reviews and merges this PR into `develop`, then prepares
  the version bump/eligible What's New entry and opens the release PR.

## Version 1.7.1 preparation — 2026-09-12

- **Scope:** the owner approved preparing the patch version and opening the
  release PR. Keep native runtime `1.3.0`; only JavaScript, dependencies, and
  documentation changed since `1.7.0`.
- **Planned commits:** marketing version bump; release bookkeeping and map update.
- **What's New:** no `1.7.1` entry. This maintenance release contains offline
  fixes and UI improvements; the features-only card policy excludes those.
- **Migrations:** no differences between `main` and `develop`; all nine existing
  filenames are recorded in the applied ledger. No production schema writes are needed.
- **Validation:** version/runtime assertions, migration diff/ledger check,
  10 regression tests, TypeScript, and whitespace checks passed. The merged
  application already passed Android/web exports and browser recovery checks
  in #177, followed by successful preview OTA on `f14a614`.
- **Commits:** `56e92fc` bumps the version; `docs: record 1.7.1 release preparation`
  updates this log and the codebase map. GitHub PRs record final merge/check state.
- **PRs:** version preparation and release PR publication follow these checks.
- **Handoff:** open the release PR after the preparation PR merges; do not merge
  `main` or trigger production publication as part of this task.

## Version 1.7.1 card follow-up — 2026-09-12

- The owner explicitly requested a one-time card for this release after learning
  that the maintenance-only entry had been omitted, then made this a standing
  rule: every release PR includes the card automatically, focused on new features
  and user-visible improvements rather than errors or technical diagnostics.
- Saved the standing rule in root `AGENTS.md`, `RELEASING.md`, and the release
  data's content-policy comment. It supersedes the earlier features-only rule.
- Add three concise highlights in `mobile/src/data/whatsNew.ts` covering cached
  session recovery, animated offline screens with retry, and clear auth errors.
- Reuse the existing version-keyed card and dismissal storage: show after sign-in
  until dismissed, then keep it hidden for this version on the device.
- Commits: `654a3aa` adds the version entry; a separate policy/copy commit saves
  the owner's standing rule; final bookkeeping records validation and handoff.
- Deliver through a small PR into `develop`, then merge it so release PR #179
  includes the card. Production release remains open for owner approval.
- Validation: TypeScript and the web export passed. The browser check with a
  mocked account verified all three `1.7.1` highlights display, Got it persists
  dismissal, and reloading keeps the card hidden. No uncaught browser errors.
- Policy/copy commit: `e77f80e`. This validation and handoff are recorded in
  `docs: record release-card policy and dismissal verification`.

## Template for the next chunk

Copy this structure when a task is assigned; replace placeholders with facts.

- **Date / outcome:**
- **Scope and acceptance criteria:**
- **Branch / base / PR:**
- **Planned small changes:**
- **Commits (hash and purpose):**
- **Decisions and relevant files:**
- **Validation (passed / failed / skipped / not run):**
- **Remaining work or blockers:**
- **Handoff / next step:**

### #264 production content-quality gate — in progress

- Investigation confirmed #260 is merged into `develop`; the current pipeline
  classified topics/subtopics and preserved a human publication gate, but only
  generated a summary/example and recorded a free-form review note. It could
  not demonstrate review of flashcards, three MCQs, sensitive-topic handling,
  or each quality criterion.
- `bdda622` adds strict generated learning-package validation: one non-repetitive
  flashcard, exactly three distinct MCQs, four distinct options per question,
  and a valid answer index. Gemini receives the matching structured-output
  schema; malformed output remains a draft-generation failure. `ece01fa` adds
  immutable backend-only quality-review evidence to each approved revision and
  requires the protected CLI publish command to read the complete checklist.
- The gate validates structure and records human judgment; it never claims that
  automation proves factual accuracy. Existing published content is untouched.
- Passed locally: focused generation and quality tests (19 passed, 13 database
  tests skipped before disposable PostgreSQL startup), then the disposable
  PostgreSQL 16 schema-contract migration test. Next: run the publication and
  full backend tests, add the operations checklist, push and open the dedicated
  `develop` PR with `Closes #264`.


### #257 weekly quiz — draft PR in progress

- [PR #286](https://github.com/Coding-Moves/one-concept/pull/286) targets `develop` and uses `Closes #257`. It remains a draft while final validation and review are completed.
- `b38aaf2` stores reviewed MCQs with published concepts, backfills exact-version approved revisions, and adds frozen weekly quiz/append-only attempt tables with the schema contract. `574de6b` adds the authenticated server selection and scoring endpoints plus PostgreSQL integration coverage. `32edf5c` adds the mobile Quiz tab with eligibility, seven answer choices, result feedback and reattempts.
- Passed: disposable PostgreSQL 16 focused schema/publication/quiz tests (**16 passed**) and mobile TypeScript. The full mobile suite reported **70 passed, 1 failed** in the unrelated public-config subprocess test; a focused rerun also failed without its expected diagnostics.
- No production migration, deployment, release version or OTA update has occurred. Next: inspect the final diff and hosted CI, resolve any actionable review finding, then mark the PR ready for owner review.
