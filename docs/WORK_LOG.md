# Work log

Keep durable working agreements in [../AGENTS.md](../AGENTS.md) and the source
navigation guide in [CODEBASE_MAP.md](CODEBASE_MAP.md). This file records current
work and handoffs. Do not store credentials, raw private data, or speculative
claims as completed work.

## Current status

- Prepared one PR chunk for [#152](https://github.com/Coding-Moves/one-concept/issues/152)
  and [#171](https://github.com/Coding-Moves/one-concept/issues/171): Resend delivery
  setup and branded authentication emails. Branch `codex/152-171-resend-auth-email`
  starts from refreshed `origin/develop` (`65eb21d`). Published as
  [draft PR #187](https://github.com/Coding-Moves/one-concept/pull/187) into `develop`.
- Owner requires a $0 setup and has chosen their existing Gmail account for
  Supabase SMTP. The owner is performing dashboard setup; saving the settings
  and actual inbox delivery remain unverified. Resend preparation stays in draft.
- Redesigned signup/recovery emails and added a matching password-changed
  notification with One Concept text branding and a linked Coding Moves masthead.
  The configured mobile images are Expo starter assets; the owner explicitly
  selected text branding. All three HTML files are ready for manual installation
  in the same draft PR. No dashboard settings were changed.
- PR #185 (#150) is merged. [PR #186](https://github.com/Coding-Moves/one-concept/pull/186)
  remains open; its independent review found no actionable issue and reran all
  63 generation tests with no skips. Its generation-budget changes are separate.
- The owner reinforced the preference for more focused commits in **all future
  PRs** for this project. Saved in `AGENTS.md`; retain individual commits and
  related tests without artificial splits or empty commits.
- PRs #183 (#133) and #184 (#149) are merged into `develop`. Release #179,
  card follow-up #180, and branch sync #181 are also merged. Their handoffs below
  record the status at the time; this task does not authorize a production release.

## Resend authentication email (#152 and #171) — 2026-09-12

### Password-changed notification follow-up

- Owner requested a matching replacement for Supabase's Password changed email.
  Add one standalone security notification in the same draft PR, followed by
  installation notes and validation. Preserve the two existing action templates.
- Rechecked Supabase's password-changed notification semantics and the support
  email in `mobile/src/screens/AboutScreen.tsx`. Use the existing text masthead
  and GitHub organization link; point support to the app's published email.
  Do not include a fabricated reset token/link or change any Supabase setting.
- Delivered `backend/email-templates/password-changed.html`: dark masthead,
  completed-change confirmation, and a separate section directing unrecognized
  changes to Forgot password and the app's support email. Added installation,
  notification-enablement, and real-inbox acceptance instructions to the runbook.
- **Validation:** all 12 local Chromium scenarios passed at 320/390/600/960px
  with normal, doubled, and stripped styles. Checked exact organization/support
  links, support-address agreement with the app, no token variables or external
  resources, no styled horizontal overflow, and readable line heights. Inspected
  mobile, desktop, and doubled-text previews. Backend/mobile tests were not run
  for this standalone HTML/documentation change; live notification delivery and
  actual email-client rendering still require verification.
- Commit `95b9db6` adds the notification; `docs: explain password changed email
  installation and validation` records its runbook, map, and handoff. Local
  Markdown file/anchor checks and `git diff --check` passed.
- **Handoff:** same draft PR #187. Copy the new raw HTML and its subject into
  Supabase's Security → Password changed template and enable that notification.
  No messages sent or production settings changed. Preserve existing commits.

### Template redesign follow-up

- Owner requested professional replacement HTML for signup and password recovery,
  with less generic copy and the official logo if available. Inspected app config,
  theme, authentication flow, and all six image assets' filenames; viewed the
  configured icon and Android foreground. No separate One Concept logo was found.
  Owner selected polished text branding after the starter-icon finding.
- Planned focused commits: record revised scope; redesign signup and verify its
  layout; apply the same design to recovery and verify its copy/links; update the
  installation notes and record final visual checks. Preserve prior commits.
- Rechecked Supabase template variables and Gmail CSS guidance. Keep account
  actions as HTML text/links, inline styles, table layout, scalable typography,
  and a full copyable verification URL. No image generation or remote logo needed.
- Delivery remains manual: the owner will paste the replacement HTML into the
  matching Supabase templates. Do not enable providers, send emails, or mark the
  draft ready without verified delivery. Browser checks are not inbox tests.
- Delivered a dark One Concept masthead, shorter account-specific messages,
  full-width buttons, and a quieter fallback area. Signup HTML is 3,176 bytes
  (18.2% smaller); recovery is 3,309 bytes (17.3% smaller). Each is 41 lines.
  Both retain all three `{{ .ConfirmationURL }}` occurrences and need no images.
- Owner also requested a clickable Coding Moves attribution. Verified
  `https://github.com/Coding-Moves` through GitHub's organization API and linked
  the masthead text once in each email. The authentication destinations are unchanged.
- **Validation:** 48 final Chromium scenarios passed: two templates, four widths
  (320/390/600/960), normal/doubled/stripped text styles, and normal/long dummy
  verification URLs. Checked exact link destinations, copyable full URLs, no
  network resources, styled overflow, readable line heights, and 44px+ actions.
  Inspected mobile, desktop, and doubled-text renders. Recovery's heading keeps
  "password" together normally and permits a soft hyphen at enlarged sizes. All authored
  text/button color pairs exceed 6:1 contrast. Local Markdown file links and
  whitespace checks passed. Actual Gmail/Outlook rendering and delivery remain
  unverified; backend/mobile tests were not run for standalone HTML/doc changes.
- Preview artifacts and the local browser harness are under
  `/tmp/one-concept-email-redesign/`, outside Git. They use dummy links only;
  the owner must copy the repository HTML, not a preview with example URLs.
- Commits: `4c75b72` records scope; `ac02745` redesigns signup; `fded7b1` redesigns
  recovery; `e09ad7a` improves heading wrapping. The organization link is recorded
  by `feat: link email branding to Coding Moves GitHub organization`.
  Installation/map changes and this handoff are recorded by
  `docs: update replacement email instructions and visual validation`.
- **Handoff:** update the same draft PR #187; replace the two HTML bodies using
  the unchanged subjects in `docs/EMAIL_SETUP.md`. Gmail setup and both inbox
  acceptance flows still require verification. No Supabase settings were changed.

### Original preparation

- Verified the mobile app uses Supabase `signUp` and `resetPasswordForEmail`;
  FastAPI supplies the existing `/confirmed` and `/reset-password` landing pages.
  There is no committed email template/setup runbook. Live SMTP configuration
  and actual delivery are unverified; source inspection cannot establish them.
- Owner selected Resend and requested one PR covering both overlapping issues.
  Prepare signup and recovery templates using the existing confirmation URLs,
  with a Resend/Supabase/DNS guide and a concrete activation checklist. Magic-link
  sign-in is not currently offered in the app and is outside this chunk.
- Read the official Resend SMTP/domain and Supabase SMTP/template documentation.
  A verified owned domain is required for real-user Resend delivery; the free
  sending plan does not provide one. Owner will perform account/registration
  steps. No credentials belong in source or the PR.
- Scope clarification: owner requires a $0 setup and will not purchase a domain.
  NIC.UA documents free .pp.ua registration/renewal and DNS, but card verification,
  phone activation, and public registrant data apply. Presented these conditions
  to the owner; no registration, payment, or disclosure of contact data performed.
  Resend acceptance of a future free domain and inbox delivery remain unverified.
- Planned commits: scope/verification; signup email; password recovery email;
  installation and operational guide; validation and PR handoff. Preserve small
  meaningful commits, owner authorship, and the existing authentication flow.
- The PR will track both issues, with live activation explicitly pending.
  Keep it in draft until both delivery flows have passed real-inbox checks;
  repository changes alone do not establish that either issue is resolved.
- Delivered standalone signup and recovery HTML with One Concept / Coding Moves
  branding, the existing Supabase confirmation variable in both action and
  fallback links, system fonts, inline styles, and no remote assets. Refined the
  copy to focus on account actions, following Supabase's transactional guidance.
- Added `docs/EMAIL_SETUP.md`: the $0 constraint, a conditional free-domain route,
  DNS and scoped-key steps, exact SMTP fields, existing redirect URLs, template
  installation, separate Supabase/Resend limits, and a live acceptance checklist.
- **Validation:** 24 local Chromium scenarios passed across both templates at
  320/390/600/960 pixels, with normal, doubled, and stripped styling. Verified
  complete dummy verification URLs, copyable fallback links, no remote resources,
  and no horizontal overflow with normal/enlarged text. Visual review caught
  overlapping enlarged text; switched to relative line spacing and rechecked.
  Inspected mobile, desktop, and enlarged-text screenshots. Text/button contrast
  exceeds 4.5:1; relative Markdown links and whitespace checks passed.
- **Limits:** no messages sent, accounts created, domain registered, payment made,
  DNS edited, SMTP activated, or production template installed. Resend acceptance,
  real inbox delivery, and native email-client rendering remain unverified. The
  first preview launch lacked Playwright's bundled browser; the installed Chrome
  completed validation. Backend pytest/mobile builds were not run because this
  chunk changes only standalone templates and documentation, not application code.
- Commits so far: `cf7cf8d` scope; `a17ede9` signup; `ed28df7` recovery;
  `a44d624` account-focused copy; `2dd12c7` setup guide; `de1d290` scalable text.
  `fd448f9` records validation and activation limits.
- **PR:** [#187](https://github.com/Coding-Moves/one-concept/pull/187), draft into
  `develop`, with closing references for both #152 and #171. Both issues remain
  open until the live activation checklist passes and the PR merges. Publication
  bookkeeping: `docs: link combined authentication email pull request`.
- **Original owner handoff (superseded by Gmail choice above):** create the free
  Resend account and decide whether NIC.UA's
  card-verification/public-contact terms are acceptable before registering any
  free domain. The question remains pending; no consent was inferred. Complete
  the exact DNS/SMTP/template steps in `docs/EMAIL_SETUP.md` once a suitable domain
  is active. No purchase or provider switch is authorized by the $0 scope.

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
