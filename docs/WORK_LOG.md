# Work log

Keep durable working agreements in [../AGENTS.md](../AGENTS.md) and the source
navigation guide in [CODEBASE_MAP.md](CODEBASE_MAP.md). This file records current
work and handoffs. Do not store credentials, raw private data, or speculative
claims as completed work.

## Current status

### #368 existing-card rehearsal and reviewer credit — PR #369 open

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
