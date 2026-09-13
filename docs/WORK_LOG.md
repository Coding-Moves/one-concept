# Work log

Keep durable working agreements in [../AGENTS.md](../AGENTS.md) and the source
navigation guide in [CODEBASE_MAP.md](CODEBASE_MAP.md). This file records current
work and handoffs. Do not store credentials, raw private data, or speculative
claims as completed work.

## Current status

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
- **Handoff:** prepare one documentation PR into `develop`, preserve its focused
  commits and leave #195 open for its separate implementation. Another task's
  appended issue-creation note in this shared log remains unstaged and preserved.

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
