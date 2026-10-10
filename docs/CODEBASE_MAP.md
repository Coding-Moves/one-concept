# Codebase map

Source inspection: 2026-09-13. This is a navigation guide to the implementation,
not a claim that deployed services or every runtime behavior have been verified.
Refresh the relevant sections when the code changes.

## Product and layout

One Concept teaches one short technical concept per day, with topic follows,
learned history, streaks, likes, saved concepts, and push reminders.

| Area | Entry points and purpose |
| --- | --- |
| Mobile | `mobile/README.md` is the local developer on-ramp; `mobile/index.ts` registers `mobile/App.tsx`; Expo SDK 57, React Native 0.86, React 19, TypeScript. `mobile/src/screens/AboutScreen.tsx` links learners to the public review explanation. |
| Review website | `admin/README.md`, `admin/src/main.tsx`, `App.tsx`; independent React/TypeScript/Vite static editorial workspace with Supabase Auth and private FastAPI calls. `admin/public/about.html` and `privacy.html` are public OAuth information pages. `admin/src/hosting.ts` generates exact-origin static response headers during build; `admin/public/_redirects` handles Netlify SPA deep links. Direct deployment steps are in `docs/EDITORIAL_ROLLOUT.md`. |
| Backend | `backend/app/main.py`; FastAPI, async SQLAlchemy/asyncpg, Pydantic settings, ES256 JWT verification. Docker uses Python 3.12. |
| Database | `backend/migrations/`; Supabase PostgreSQL schema, RLS, seeds, and incremental migrations. |
| Content lifecycle | `docs/CONTENT_ARCHITECTURE.md`, `docs/CONTENT_OPERATIONS.md`; portable subject/curriculum imports, durable refill, reviewed publication, daily review, protected health report. |
| Content engine | `backend/app/services/generation.py`, `pool.py`, `prefetch.py`; Gemini lessons from a curated backlog. |
| Operations | `.github/workflows/`, `backend/railway.json`, `backend/Dockerfile`, `mobile/eas.json`, `mobile/app.config.js`. |
| Hosting migration | `docs/RAILWAY_MIGRATION.md`; source/destination evidence, worker handover, EAS endpoint publication, recovery redirects and retirement. New Railway services use dashboard settings because legacy Config as Code is deprecated. |
| Documentation | Root `README.md`, `RELEASING.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the backend/mobile guides. |
| Agent guidance | Root `AGENTS.md`; `mobile/AGENTS.md` adds Expo documentation requirements and `mobile/CLAUDE.md` references it. |
| Authentication email | `backend/email-templates/` contains branded signup, recovery, and password-changed HTML; `docs/EMAIL_TEMPLATES.md` covers manual Supabase installation and activation checks. Templates use the configured sender and are not installed by app deployment. |
| Engineering handbook | `docs/handbook/ONE_CONCEPT_HANDBOOK.md` explains the full stack and learning lifecycle; `docs/handbook/build_pdf.py` renders the printable guide with vector diagrams. Build and verification instructions are in `docs/handbook/README.md`. |

## Editorial identities (#274)

`api/v1/editorial.py` exposes private account/onboarding and owner-management APIs.
`services/editorial_accounts.py` verifies current Supabase sessions, confirmed
email, membership, capabilities and MFA before account-lock acquisition and
again afterward, using current-query time for session deadlines;
`editorial_management.py` serializes
versioned account mutations and records their audit events. `editorial_invites.py`
is the server-only Auth invitation adapter. Migration `0032_editorial_accounts.sql`
keeps memberships and account events inaccessible to browser roles. The one-time
owner CLI is `python -m app.workers.editorial_accounts`; see
[editorial-accounts.md](editorial-accounts.md) for activation and frontend handoff.
`services/editorial_revisions.py` adds authenticated, immutable exact-revision
review decisions and legacy attestation (#275); migration 0033 stores the one-time
published inventory, review events and exact-version provenance. `publication.py`
requires that approval through the authenticated service; the old free-text CLI
publish/reject commands fail closed. See [editorial-provenance.md](editorial-provenance.md).
`api/v1/editorial_content.py` exposes #276 queues, details, history/timeline and
versioned actions. `editorial_queries.py` builds private read models;
`editorial_workflow.py` owns authenticated commands, request receipts and workflow
audit. Published and retired revision details compare their immutable base
snapshot with the reviewed body; `review`, `approve`, or `publish` permits
MFA-gated reading, while assignments require an active `review` member.
Migration 0034 adds private workflow evidence/assignment metadata. The
operator client `python -m app.workers.editorial_review` uses those same HTTP
gates. See [editorial-api.md](editorial-api.md) for permissions, retry semantics
and rollout. The `admin/` website (#278) consumes these APIs; mobile attribution (#280) projects exact-version evidence through learner reads;
owner reporting (#297) remains a separate child of #263.
`services/editorial_notifications.py` drains the private #279 outbox through the
existing reminders worker; `editorial_mail.py` uses Gmail HTTPS/OAuth (no Railway
SMTP upgrade). `editorial_email_template.py` renders the escaped HTML template
in `app/templates/editorial_review.html` alongside a plain-text fallback.
`api/v1/editorial_notifications.py` exposes owner delivery/policy
controls and the reviewer timezone. `admin/src/Notifications.tsx` shows overdue
work and safe retries. See [editorial-notifications.md](editorial-notifications.md)
for migration 0038, free sender setup and the direct production email rollout.

`editorial_generation.py` owns #277 authenticated durable revision requests,
claim fencing, provider orchestration and private draft completion. Migration
0035 stores immutable source/feedback/result links and backlog claim tokens.
`editorial_generation_status.py` exposes bounded private supply/planning status;
`review_capacity.py` shares human-work limits across pool/prefetch/rewrite paths.
The existing `workers/pool_topup.py` runs a bounded revision batch before refill;
`content_health.py` adds aggregate job conditions. See
[editorial-generation.md](editorial-generation.md) for API and staging contracts.

## Learner review attribution (#280)

`services/review_attribution.py` selects public name/date/version evidence in the
same SQL statement as a published lesson. `schemas/daily.py` adds nullable
`ConceptOut.review`; detail, daily selection and folded state/review paths use it.
`mobile/src/services/conceptMapping.ts` shares version validation across detail,
daily and cached reads. `components/ReviewAttribution.tsx` renders borderless
credit in `ConceptDetailScreen` and below the Today lesson card. Legacy and
mismatched-version metadata have no label.
`components/CardInformation.tsx` supplies the shared card's three-dot metadata
sheet on Today and saved/history detail, using that same exact-version check.
`services/state.py` and `schemas/me.py` expose `bookmark_versions` aligned with
all saved slugs in `/v1/me/state`, including compact responses.
`mobile/src/services/savedConceptSync.ts` uses these versions to replace only
outdated offline saved bodies after an authenticated state refresh, with an
account epoch fence and conservative fallback for older API responses.
See [editorial-provenance.md](editorial-provenance.md#learner-attribution-280)
for compatibility, historical offline semantics and rollout.

## Editorial website (#278)

`admin/src/App.tsx` owns session fencing, capability gates and navigation.
`main.tsx` supplies the current Supabase session to `api.ts` before private
requests; the API client refreshes an idle token and fences account changes and
late denials without discarding recoverable review work.
`Auth.tsx` handles invitation/recovery, password and MFA; `Settings.tsx` handles
registered identity. `Queue.tsx` supplies topic/status/deadline filtering and
shared approved/published views. `Review.tsx` and `LessonView.tsx` render complete
packages, diffs, history, comments, checklist decisions and safe corrections.
`Team.tsx` manages owner-only membership; `Generation.tsx` requests bounded work.
`LegacyEnrichment.tsx` previews eligible existing lessons and controls one
subject batch at a time. `services/legacy_generation.py` builds a grounded
complete-card candidate and `legacy_enrichment_worker.py` stages it privately
through the scheduled `pool_topup.py` run; only a later human approval publishes.
`MarkdownText.tsx` safely renders lesson writing and `LessonEditor` shows a live
preview; identifiers and configuration fields remain plain text.
`api.ts` and `useCommand.ts` preserve exact operation retries and stale-token
failures. Migration 0037 adds audited review deadlines. Queue totals are computed
with page results in one statement; published rows require matching exact-version
provenance. Build/browser CI uses public fixture values only. See
[the review website guide](../admin/README.md) for staging and hosting boundaries.

## Owner dashboard (#297)

`admin/src/OwnerDashboard.tsx` contains read-only activity, reviewer, operations
and event views. `OwnerDemo.tsx` / `ownerDemo.ts` provide a deterministic adapter
selected before Auth/API initialization. `api/v1/owner.py` enforces the existing
`manage_reviewers` administrator capability; `services/owner_reporting.py`
aggregates canonical completions and immutable editorial evidence.
`services/owner_telemetry.py` records opt-in bounded observations from the API and
existing workers. Migration 0039 adds the private telemetry table and report
indexes; the schema contract includes them. See [owner-dashboard.md](owner-dashboard.md)
for metrics, privacy, retention and activation deferred to #281.

## Achievements (#209, #259)

`services/achievements.py` awards permanent, data-driven milestones under the
existing profile lock and caller transaction. Migration `0016_achievements.sql`
introduces streak awards; `0027_expanded_achievements.sql` adds categorized
concept, review, weekly-quiz, perfect-score and distinct learning-path
achievements with a historical backfill. The evaluator reads only accepted
server records, with the composite award key preserving a first-earned date on
retries or concurrent devices. Weekly quiz submission takes the profile lock
before scoring and evaluating awards. `api/v1/achievements.py` serves the
collection, category/requirement/progress metadata and seen APIs.

On mobile, `AchievementsContext` owns one keyed account instance,
`achievementStore` fences async results, and `achievementCache` joins account
cleanup. Profile opens `AchievementsScreen`; shared badge/detail/celebration
components render every category and a server-confirmed nearest milestone.
See [ACHIEVEMENTS.md](ACHIEVEMENTS.md) for rollout and extension rules.

## Conservative future-card refill (#353)

`services/future_refill_budget.py` reserves Pacific-day global and per-topic
allowance rows exclusively for curated future-card refill. `pool.py` gives each
recorded low-supply topic one normal slot before any optional urgent second pass;
`prefetch.py` schedules only one demand-triggered normal slot after the daily
response commits. Editorial corrections and legacy enrichment retain their own
generation paths and cannot consume this allowance. `content_health.py` reports
per-topic low-supply eligibility and the separate budget. See
[FUTURE_REFILL_ROLLOUT.md](FUTURE_REFILL_ROLLOUT.md) for release-only migration,
Railway variables, verification and rollback.

## Future multilingual content (#265)

`docs/multilingual-content/README.md` is the approved future-work design for
localized daily lessons, flashcards and quizzes. Canonical concept identities
remain the source of progress, history and analytics; future reviewed locale
variants supply complete learner-facing payloads with server-selected fallback.
Language-learning study cards and games are a separate future model, not copies
of technical concepts or translations. This section documents no runtime
implementation.

## Learning analytics (#258)

`services/analytics.py` provides the single bounded, account-scoped read model
behind `GET /v1/me/analytics`. It counts accepted concept completions, completed
reviews and immutable weekly quiz attempts; derives streaks with the existing
service; groups the fixed 28-day activity window in the profile IANA timezone;
and reuses the existing server evaluators for topic, subtopic and achievement
progress. It does not write client-derived counters or expose another account’s
data. `schemas/analytics.py` owns the response contract and
`tests/test_analytics.py` covers authentication and local-day aggregation.

`services/analyticsApi.ts` supplies an account-fenced typed client. Profile opens
`AnalyticsScreen`, which displays a quiet server-confirmed summary, seven-day
activity view, quiz performance, actual topic distribution, learning-path
progress, recent concepts and achievement totals. Empty/loading/unavailable
states are explicit; the screen fetches only for the signed-in account and can
be refreshed manually.

## Subtopic completion (#261)

`user_concept_completions` is the authoritative record that a learner has
consumed a concept, distinct from the date a daily assignment counts for a
streak. Migration `0023_subtopic_completions.sql` backfills it from completed
daily assignments; `0024_backfill_subtopic_completion_events.sql` records
already-complete paths as seen historical events. `user_subtopic_completions` records an immutable event for
the exact sorted set of published concept IDs in an active subtopic. A new
published concept produces a different catalog signature and naturally returns
the path to active progress; an editorial revision does not.

`services/subtopic_progress.py` calculates boundaries server-side under the
same profile lock as daily completion. `GET /v1/me/subtopics/progress` provides
Profile’s learning-path summary; `POST /v1/daily/complete` returns a completion
event only when it was newly recorded. The Today card appears only for that
confirmed response, while the acknowledgement endpoint retains delivery state
for later achievement and challenge work.

## Optional subtopic quizzes (#262)

`subtopic_quizzes` freezes up to seven reviewed MCQs against a learner-owned
`user_subtopic_completions` event. The snapshot stores every source concept
slug, content version, question, option and answer key. A new content catalog
therefore creates a distinct future completion event, while an already opened
quiz stays unchanged. `subtopic_quiz_attempts` is append-only: retries create
new answer/score rows and the history endpoint retains earlier results.

`services/subtopic_quizzes.py` chooses only reviewed MCQs from the completion
record’s exact concept IDs and never generates questions at request time.
`api/v1/subtopic_quizzes.py` keeps answer keys server-side until submission.
Composite ownership constraints keep quizzes and attempts bound to the same
account as their completion parent. Profile exposes completed paths through
`SubtopicQuizzesScreen` and `SubtopicQuizScreen`; the feature is optional and
never changes a daily lesson, streak or weekly quiz.

## Mobile navigation and presentation

`App.tsx` composes SafeArea, Theme, Connectivity, Auth, and Progress providers.
The signed-in shell owns top/side safe-area padding outside scrolling screens;
its offline/sync banners and Achievements header avoid adding that inset twice.
Bottom tabs retain their own bottom inset. Native achievement modals still
handle their own insets.
It holds the native splash until fonts are ready (or fail), checks public API and
Supabase configuration before starting providers, and wraps the root in
`AppRecoveryBoundary`. `ConfigurationState`, `UnavailableState`, and
`api/errorRecovery.ts` provide safe learner-facing recovery copy; raw API error
payloads are not rendered. `components/support.ts` opens the support email.
The root then lays out the signed-in flow.
The visible signed-out flow is `AuthScreen`; authenticated users get bottom tabs
inside a root stack, with a concept-detail modal above them.

| Screen | Responsibility |
| --- | --- |
| `TodayScreen.tsx` | Daily lesson, learned action, streak, loading/exhausted/offline states, and a server-confirmed topic-selection prompt when no topics are followed. |
| `HistoryScreen.tsx` | Paginated learning history, search within loaded records, offline pages and navigation to concept details. |
| `StatsScreen.tsx` | Learned-only overall/topic counts and separate compact review activity; no catalog denominators or completion bars. |
| `AnalyticsScreen.tsx` | Profile-linked, server-confirmed concepts, reviews, activity, quizzes, topics, learning paths and achievements with empty/recovery states. |
| `WeeklyQuizScreen.tsx` | Optional server-backed weekly quiz: eligibility progress, seven reviewed questions, icon-marked accessible answer selection, result feedback and reattempts. |
| `SubtopicQuizzesScreen.tsx` / `SubtopicQuizScreen.tsx` | Profile-linked optional quizzes for completed subtopics, frozen reviewed questions, icon-marked accessible answer selection, retries, and prior-score history. |
| `ProfileScreen.tsx` | Task-grouped account hub: profile/privacy, learning, topics, preferences, library and support. It keeps clear reminder prerequisites and immediate per-control queued reminder writes. |
| `EditProfileScreen.tsx` / `services/profilePhotoPicker.ts` | Name and bio editing, camera/library photo preview and explicit save, account-bound Android picker recovery, and confirmed avatar writes. |
| `ProfileSharingScreen.tsx` / `ProfilePublishReviewSheet.tsx` / `PublicProfileLink.tsx` | Opt-in, independently selected sharing fields, a private review-before-publish step, explicit unpublish confirmation, native share/local QR, and uncached incoming public-profile view. |
| `PersonalizationScreen.tsx` | Server topic catalog and follow controls through `useTopics`. |
| `SavedScreen.tsx` | Recent/cached saved concepts, older metadata pagination, search/category filters, and detail navigation. |
| `ConceptDetailScreen.tsx` | Cached full lesson first, then online refresh by slug; bundled catalog fallback. |
| `AuthScreen.tsx` | Sign-in, sign-up, password recovery, and accessible show/hide password controls that reset on mode changes or submission. |
| `AboutScreen.tsx` | Branding and app information. |

All screens live in `mobile/src/screens/`. Reusable presentation in
`mobile/src/components/` covers lesson cards/actions, category/follow controls,
reviewed lesson and quiz Markdown through the pure-JavaScript `MarkdownText`,
like counts, streak/flame visuals, buttons, skeletons, the offline banner,
`SearchField` and `CollectionConceptRow` for compact accessible Saved/History collections,
`UnavailableState` (animated offline/retry UI), and the What's New card.
`ScreenHeader` supplies the common eyebrow/title/supporting-copy hierarchy and
`Surface` supplies the borderless elevated containers. `useReducedMotion` gates
tap feedback, while `UnavailableState` uses a single short entrance motion and
`SyncStatusBanner` gives paused offline writes a clear retry action.
Saved uses a non-shrinking horizontal ScrollView for its short filter rail, with
content-driven chip height and separate virtualized lesson rows.
`src/theme/index.ts` defines readable text/control, success, danger and subtle
surface colours plus touch-target and motion constants.
Only Today’s green completion pill has a half-point UI outline; other containers
use borderless surfaces and spacing. The theme also defines spacing, radii,
typography, shadows, and scaling; `ThemeContext` persists light/dark preference.
`src/navigation.ts` types the root stack.

History uses `hooks/useHistory.ts` and `services/historyApi.ts` to load one
50-item page per request from the existing history endpoint. Page caches join
account cleanup; the startup progress aggregate remains compact. Data screens
share `hooks/useRefreshControl.tsx` for native pull gestures and refresh buttons.

## Mobile state, persistence, and API boundaries

- `src/lib/supabase.ts` creates the Auth client and remains import-safe when public configuration is absent so the configuration recovery UI can render. `secureStorage.ts` chunks native
  session storage through Expo SecureStore, with AsyncStorage on web.
- `AuthContext.tsx` owns session startup, sign-in/up/recovery/sign-out, supplies
  the API token provider, and triggers push registration and timezone sync.
  `services/authSession.ts` restores cached identity while refresh is pending;
  confirmed sign-out still clears account caches. `authErrors.ts` keeps raw
  transport diagnostics out of authentication forms.
- `src/api/client.ts` makes authenticated JSON requests, exposes `ApiError`, and
  infers connectivity from request results. Its account epoch rejects a request
  that crosses sign-out/sign-in, and it honors a server `Retry-After` hold.
  `ConnectivityContext` drives the global banner; there is no native
  connectivity listener.
  `api/fetchWithTimeout.ts` bounds API and auth fetches to 15 seconds.
- `ProgressContext.tsx` is the shared UI state owner. It loads cached state
  before revalidation, applies optimistic actions, serializes mutation requests,
  and flushes queued work on the same mutation chain. `services/syncLoop.ts`
  retries while offline or actions remain, using 5–30 second backoff, including
  when only some requests succeed. Daily refreshes preserve pending actions;
  account/source changes invalidate them and clear the displayed state. Foreground
  and reconnect events revalidate progress and the topic catalog even with an
  empty mutation queue; backgrounding pauses timers.
  This remains compatible with the current APK and has no closed-app worker.
  Screen retries use its serialized `refresh`; topic and detail screens have
  their own retry paths. Failed loads do not substitute demo lessons or totals
  for an authenticated account.
- `services/progressRepository.ts` defines the persistence interface.
  `remoteProgressRepository.ts` implements API state, account caching, optimistic
  offline fallbacks, and replay. It opts into compact startup metadata; Stats
  uses full server totals plus older-topic counts through `progressTotals.ts`.
  `pendingProgress.ts` retains unacknowledged
  likes, saves, and same-day completions during server reconciliation.
  `localProgressRepository.ts` and `storage.ts`
  retain local/demo support; this is not a separate visible guest navigation flow.
- `mutationQueue.ts` wires AsyncStorage to `mutationOutbox.ts`, which serializes
  disk writes and stores the latest intent per like/save/topic/completion key.
  Replay discards stale-day completions, retains retryable failures with a
  persisted 5-second-to-5-minute backoff, and pauses after eight attempts until
  the learner explicitly retries. It does not backdate server completion.
- `accountCaches.ts` centralizes account cache cleanup. The remote repository's
  epoch guards reject late mutation callbacks after a wipe; the API invalidates
  requests still waiting for an old account's token during cleanup.
  Device theme/demo state is separate from account data.
- `dailyApi.ts` maps server concepts to UI types and clears an old daily cache;
  current daily data arrives in `/v1/me/state`. `conceptApi.ts` persists full
  lessons by slug, including each cached daily lesson and missing saved lessons
  downloaded with three workers. Offline reading requires a completed download.
  `offlineCache.ts` provides per-entry storage and fences late writes on sign-out.
- `mobile/tests/` uses Node's built-in runner for pure service, storage, account-boundary and sync-loop regressions; browser scripts exercise exported-app flows without live credentials. The helper resolver lets Node load Metro-style extensionless source imports without adding a second test framework.
  UI concept IDs are slugs, while the database also has UUIDs.
- `hooks/useSavedConcepts.ts` loads older Saved metadata in 50-record pages on
  that screen, retaining full search/filter access. `services/savedApi.ts` owns
  its account-keyed disk cache; `accountCaches.ts` clears it and invalidates late
  writes. Missing offline metadata can be recovered from downloaded lesson bodies.
- `hooks/useTopics.ts`, `services/topicsApi.ts`, and `topicStore.ts` share the
  cached dynamic topic catalog. Follow changes enter the same durable outbox as
  other actions; queued choices override stale server responses until replay.
  Both the catalog and full-concept cache participate in account cleanup.
- `services/notifications.ts` handles permissions, Android channel setup, Expo
  tokens, timezone sync, preference caching, and deregistration before sign-out.
- `data/concepts.ts`, `services/dailyConcept.ts`, `dates.ts`, `streak.ts`, and
  `topics.ts` support the bundled catalog, local selection, dates, and mappings.
- `data/whatsNew.ts`, `hooks/useWhatsNew.ts`, and `services/whatsNewStore.ts` control
  version announcements. Every release includes a matching one-time card focused
  on new features and user-visible improvements, per `RELEASING.md`.
  `components/WhatsNewCard.tsx` scrolls long highlight lists independently of the
  heading/dismissal controls so small screens can reach every item.
- `src/types/index.ts` defines shared concept, progress, daily, history, and
  streak types. API payloads also have types near their service consumers.

## Incident response

[INCIDENT_RESPONSE.md](INCIDENT_RESPONSE.md) defines the production triage and
communication sequence for Railway API/workers, Supabase, GitHub release gates,
and mobile delivery. It deliberately separates learner-safe UI recovery from
private diagnostics and restore procedures.

## Backend request and service flow

`main.py` configures CORS, routes, production documentation visibility, safe SQLAlchemy and unexpected-exception responses, and a shared
JWKS cache, and engine cleanup. Its lifespan owns `db/keepalive.py`'s configurable
database probes; checkout/query and connection return are bounded, failures retry,
and cancellation awaits cleanup before engine disposal. `config.py` loads settings
and normalizes pooler URLs; `db/session.py` creates the async engine/session
dependency and reuses the most recently returned connection to keep a hot slot.
The existing pre-ping, transaction pooler mode, and pool limits remain in place.
Authenticated routes pass through `core/rate_limit.py` after JWT verification. It uses bounded in-process per-account read/write token buckets, returning `429` with `Retry-After`; a multi-replica deployment must replace it with shared state.
`deps.py` obtains identity from bearer tokens verified by `core/security.py`
(ES256, issuer, audience, expiry, and subject). `core/errors.py` formats auth errors.

| Routes (`backend/app/api/v1/`) | Implementation |
| --- | --- |
| `health.py`: `GET /health` | Liveness plus a database query. |
| `topics.py`: `GET /v1/topics` | Active topics, published counts, follow state. |
| `daily.py`: `GET /v1/daily`, `POST /v1/daily/complete` | Selection, completion, server-derived date and streaks. Typed 409 reasons distinguish `personalization_required` (no active follows) from `catalog_exhausted`. |
| `me.py`: `GET /v1/me/state`, `/stats` | Optional compact state, exact totals, today's lesson. |
| `me.py`: `GET /v1/me/history`, `/saved` | Cursor pages through `services/collections.py`; default 50, maximum 100 items. |
| `analytics.py`: `GET /v1/me/analytics` | Bounded account-owned learning totals, timezone-grouped activity, quizzes, topic/subtopic progress and achievement collection. |
| `me.py`: `PUT /v1/me/topics`, `PATCH /v1/me` | Whole-set follows, profile name, PostgreSQL-validated timezone. |
| `me.py`: `GET/PUT /v1/me/notifications`, `POST/DELETE /v1/me/push-token` | Reminder preferences and scoped device registration/removal. |
| `concepts.py`: `GET /v1/concepts/{slug}`, `PUT/DELETE .../like`, `.../save` | Published lesson detail and independent interaction writes. |
| `pages.py`: `GET /privacy`, `/confirmed`, `/reset-password` | Public privacy and branded Auth landing pages; email redirects use the mobile API origin and reset uses Supabase Auth in the browser. See [auth redirects](AUTH_REDIRECTS.md). |

`router.py` mounts authenticated feature routers under `/v1`. Response/input
models live in `schemas/daily.py`, `me.py`, `notifications.py`, and `topics.py`.

- `services/selection.py` returns an existing assignment first. With no active
  followed topic it returns the stable `personalization_required` state without
  creating an assignment or signaling generation. On a new local day it carries
  the most recent unfinished lesson in a still-followed topic forward until
  completion, retaining the same assignment row and first assigned timestamp.
  Otherwise it excludes previously assigned concepts, prefers the least recently
  seen followed topic. When the followed pool has no unfinished or new lessons,
  selection offers a review chosen by `services/reviews.py` from a followed topic
  or waits for publication. Completed dates stay fixed. Selection handles
  concurrent inserts and schedules background prefetch, never waits on Gemini.
  `GET /me/state` projects the same condition through `daily_availability`; old
  clients can safely ignore that additive field.
- `services/state.py` aggregates profile, follows, learned/saved metadata, likes,
  assignment slug, and derived streaks in one SQL statement. The `/me/state`
  handler then calls selection separately to add `daily` and aligns
  `assignment_slug` with the resulting card; one HTTP request does not mean one
  database statement for the entire endpoint. Compact clients get
  at most 50 enriched learned/saved rows, older-topic counts and continuation
  cursors; bare membership and aggregate streak/totals remain complete. Legacy
  clients keep the full detail lists until upgraded.
- `services/interactions.py` implements likes/saves, full-set follows, and
  idempotent completion of the most recent assignment from today or yesterday.
  Yesterday's grace applies when there is no newer assignment; older days cannot
  be completed. `streaks.py` derives consecutive runs from assigned completion days.
- `services/users.py` provides bootstrap fallback for the new-user DB trigger.
  `services/concepts.py` loads published details. Public like counts exclude the
  viewer's own like; the mobile UI adds that one locally.
- `services/generation.py` builds versioned prompts, calls Gemini through httpx,
  validates output, and exposes rate-limit errors. `pool.py` claims backlog work
  with `FOR UPDATE SKIP LOCKED`, stages generated concepts and editorial revisions, refunds throttled
  attempts and reclaims stale work. Claims and daily call reservations commit
  together before contacting the provider; quota denial rolls back the claim.
- `services/generation_budget.py` atomically reserves from the shared
  `generation_daily_usage` ledger using PostgreSQL's Pacific calendar day. All
  API prefetch, scheduled refill, manual rewrite and editorial revision jobs share
  this budget and concurrency limit.
  Failed/uncertain calls retain their reservation; restarts do not reset it.
- `services/prefetch.py` schedules bounded background top-ups, with a low unread
  watermark, durable per-topic targets, and per-process in-flight topic tracking.
  Exhausted shared budget is a normal stop condition.
- `services/reminders.py` claims due user/day/time slots before sending Expo push
  batches, handles timezone and midnight windows, suppresses completed days, and
  drops unregistered device tokens. A claimed but failed send can miss a reminder.
- `workers/pool_topup.py` and `workers/reminders.py` are cron entry points.
  `workers/rewrite_catalog.py` is a maintenance command that rewrites existing
  lessons through Gemini with the shared budget and generation kill switch;
  do not run it merely to inspect the project.

## Sustainable learning additions (#195)

- `services/curriculum.py` validates subject/subtopic/plan imports, duplicate
  candidates and prerequisite graphs. `backend/content/subjects.json` and
  `backend/content/subtopics.json` retain the five-topic taxonomy;
  `curriculum.example.json` shows future data-only expansion;
  `curriculum.refill-launch.json` is the five-subject reviewed first refill
  backlog packaged in the backend image for an explicit operator import.
- `services/supply.py` persists assigned-count-plus-reserve demand and plans for
  active readers. `pool.py` counts drafts/in-flight claims in capacity and calls
  the shared quota/concurrency checks before committing any provider request.
  `prefetch.py` starts only after the demand transaction commits.
- `services/publication.py` stages corrections, validates explicit approval and
  increments versions while preserving identities and prior bodies.
  `workers/rewrite_catalog.py` now drafts revisions under durable claims.
- `services/reviews.py` and `api/v1/reviews.py` select/complete separate review
  records. `selection.py` locks profiles across daily choice; `streaks.py`,
  `state.py` and reminders count completed review days without increasing unique
  learned totals. `me/state?reviews=true` opts into a separate review payload.
- `services/weekly_quiz_notifications.py` queues opted-in unfinished quizzes at local 09:00, claims per-device deliveries before HTTP, and tracks Expo tickets/receipts with bounded safe retries. Migration `0031_weekly_quiz_notifications.sql` stores preferences and the private outbox. `workers/reminders.py` runs it after daily reminders only when its rollout flag is enabled. Mobile `WeeklyQuizNotificationNavigator.tsx` consumes cold/warm taps inside the authenticated navigation tree; `weeklyQuizNotificationIntent.ts` validates and deduplicates payloads. See [weekly-quiz-notifications.md](weekly-quiz-notifications.md) for activation and delivery limits.
- `services/weekly_quizzes.py` freezes one reviewed MCQ from each of seven completed concepts into a per-user weekly snapshot. `api/v1/quizzes.py` scores submissions server-side and appends immutable attempts; answer keys are only returned after submission.
- `services/subtopic_quizzes.py` independently freezes reviewed questions from one completed subtopic’s exact catalog. `api/v1/subtopic_quizzes.py` permits repeat attempts and returns account-scoped attempt history; it does not couple the subtopic flow to the weekly quiz.
- `workers/content.py` exposes maintainer-only imports, revision inspection,
  approval, failed-plan correction/retry and health reports. `content_health.py`
  computes supply/queue/quota/worker conditions and deduplicates transitions.
  This uses backend credentials, with no public administration API.
- Mobile review payloads and versioned concept bodies use the existing caches;
  review IDs key durable outbox intents. `pendingProgress.ts` merges pending
  completion without new learned rows. Today labels review/exploration and
  Stats separates review totals. Dynamic subject labels use existing generic UI.
- Added regressions cover imports, publication races, two-device review, grace,
  refill/call bounds, a 365-day three-reader simulation, protected health changes,
  backup restoration, and browser offline/reconnect in both themes.

## Schema and migrations

`db/schema.py` compares actual catalog metadata against `backend/schema/contract.json`.
`workers/schema_check.py` performs the bounded read-only target check using
`DIRECT_URL`; `docs/SCHEMA_VERIFICATION.md` covers contract maintenance and
Railway/GitHub setup. No SQL is applied by verification.

`db/models.py` mirrors the SQL schema; migrations are the schema authority.
The seventeen tables cover profiles, topics, concepts, user topics, daily assignments,
concept interactions, notification preferences, device tokens, the concept
backlog, reminder logs, shared daily generation usage, supply targets, editorial
revisions/retry logs, daily reviews, worker runs and health conditions. Unique constraints
enforce one daily assignment and no concept repeats per user. RLS adds isolation behind backend identity checks.

| Migration | Purpose |
| --- | --- |
| `0001_schema.sql` | Core tables, indexes, timestamps, new-user bootstrap trigger. |
| `0002_rls.sql` | Read/write ownership policies. |
| `0003_seed_topics.sql`, `0004_seed_concepts.sql` | Five topics and twenty initial lessons. |
| `0005_concept_backlog.sql`, `0006_seed_backlog.sql` | Curated generation queue and seed subjects. |
| `0007_reminder_log.sql` | Unique reminder claims. |
| `0008_backlog_claimed_at.sql` | Timestamp for reclaiming abandoned generation. |
| `0009_like_count_index.sql` | Index for public like counts. |
| `0010_generation_daily_usage.sql` | Backend-only daily Gemini call reservations shared by all generation paths. |
| `0011_content_supply.sql` | Durable, coalesced demand beyond bootstrap inventory. |
| `0012_curriculum_publication.sql` | Structured curriculum, content versions, review drafts and audited retry grants. |
| `0013_daily_reviews.sql` | Separate review activities; preserves new-assignment uniqueness. |
| `0014_content_operations.sql` | Worker heartbeat and deduplicated condition state. |
| `0015_revision_generation_claims.sql` | Durable claims for correction drafting. |
| `0017_topic_subtopics.sql`–`0019_subtopic_topic_cleanup.sql` | Parent-scoped subtopics, explicit classification of published/planned content, category integrity, and safe empty-topic cleanup. |

Migrations 0001–0015 are recorded in `migrations/applied.txt`. The owner applied
0011–0015 during 1.9.0 release preparation, and a separate read-only production
connection verified their tables, RLS, columns, indexes, constraints and backfill.
The backend/worker rollout remains pending; the ledger does not prove deployment.
Application connections use the transaction pooler; migration DDL uses `DIRECT_URL`
and the session pooler. Applied migrations must not be rewritten.

## Builds, checks, and releases

- Mobile dependencies/scripts are in `mobile/package.json` and `package-lock.json`;
  use npm. `npm run typecheck` runs `tsc --noEmit`; `npm test` uses Node 24's
  built-in runner for session recovery, auth messages, request timeouts, offline
  cache cleanup, outbox ordering, topic persistence, and sync scheduling.
  Expo provides Android/iOS/web development commands. Native project folders are
  not tracked. EAS profiles separate development, preview, production, and production APKs.
- Backend dependencies are pinned in `requirements.txt`/`requirements-dev.txt`.
  From `backend/`, run `.venv/bin/python -m uvicorn app.main:app --reload --port 8000`
  for development and `.venv/bin/python -m pytest` for tests after configuration.
- Nine test modules cover HTTP contracts, token validation, daily selection,
  writes/streaks, generation, reminders, notification preferences, and connection
  warm-up/cleanup. The pool integration checks compare real PostgreSQL idle expiry
  with warming disabled/enabled and print timing plus physical-connection counts.
  `tests/conftest.py` supplies a disposable PostgreSQL 16 database through Podman
  on port 55433, applies every migration, and disables live generation. HTTP calls
  to Gemini/Expo are mocked. Database-dependent tests skip if Podman cannot start.
- `.github/workflows/eas-update.yml` publishes preview OTA on qualifying mobile
  pushes to `develop`; manual dispatch also publishes preview only. `eas-build.yml` is
  a manual Android build workflow.
- `release.yml` is manually dispatched on `main` after operator confirmation of
  the deployed backend/worker SHA; its guard rejects missing/mismatched revisions
  and non-main dispatches. It publishes production then preview OTA, creates a
  version tag/GitHub release, and dispatches `release-apk.yml`. APK publication
  is gated on native `runtimeVersion` changes. Railway deploys the backend
  independently; follow `RELEASING.md` for migration and release ordering.
- `pr-quality.yml` is the general pull-request gate for `develop` and `main`.
  It runs mobile Node 24 typechecking/tests and backend Ruff F/E9 plus pytest.
  The backend job installs Podman and fails if its disposable PostgreSQL 16
  fixture skips, so a green backend result includes database coverage.
  `migrations.yml` separately checks the applied ledger on `main` and PRs into
  `main`; trusted main runs use a direct `production-schema` environment job.
  `release.yml` uses its own direct protected actual-schema job before OTA;
  `production-schema.yml` remains independently dispatchable. `audit.yml` runs dependency audits, Ruff, and TypeScript checks and
  files findings as issues. `cleanup.yml` manages stale issues; Dependabot
  schedules dependency updates with Expo-managed version restrictions.
- `mobile/app.config.js` currently has app version `1.10.4` and native runtime
  `1.10.1`; `package.json`'s `1.0.0` is not the release-version authority.

## Documentation drift to remember

These observations are recorded for future assigned work; setup does not change
the implementation or older documentation:

- Backend/architecture prose still describes synchronous on-demand generation;
  selection now schedules background prefetch within followed topics.
- `/me/state` documentation says one query; its aggregate is one query, followed
  by selection queries for the folded daily lesson.
- Some comments describe the HTTP client as unwired or the repository as local
  only. Both are used by the authenticated application today.
- `mobile/DEPLOYMENT.md` describes an older OTA trigger and fewer workflows.
  Use current workflow YAML plus `RELEASING.md` to trace release behavior.
- The roadmap's older offline milestones predate the current full-lesson cache,
  cached personalization, and foreground queue synchronization. Closed-app OS
  background scheduling remains outside the current APK's capabilities.
- The backend README's test-count/phase notes are historical. See
  [WORK_LOG.md](WORK_LOG.md) for the actual local validation baseline.

### Public profile privacy

`api/v1/profile_sharing.py` exposes caller-owned settings and separately filtered
public JSON/browser reads. `services/profile_sharing.py` owns row locking, version
checks, earned-achievement filtering and revocable random tokens. Migration 0028
adds the backend-only sharing table; 0029 preserves stored timezones during phone
initialization; 0044 adds the default-off public bio choice. The owner Profile
reads the saved bio from progress; `ProfileSharingScreen.tsx` and
`ProfilePublishReviewSheet.tsx` review its public choice, while `PublicProfileLink.tsx`
shows only the anonymous allowlist. `mobile/src/services/profileSharing.ts` owns link parsing, local QR
and anonymous visitor requests. See [profile-sharing.md](profile-sharing.md) for
privacy guarantees, migration order and phone acceptance checks.

### Mutual Connections

`api/v1/connections.py`, `schemas/connections.py` and `services/connections.py`
provide the private consent lifecycle, request preferences, blocks and database
rate/cooldown limits. Migration 0030 adds the RLS-protected tables and pair/index
constraints. `ConnectionsScreen.tsx` owns private list/settings states;
`ConnectionControls.tsx` adds explicit actions to a shared-profile view. The typed
`services/connections.ts` client and transient `publicProfileNavigation.ts` keep
navigation/account boundaries separate from anonymous profile data. See
[connections.md](connections.md) for API, privacy, deployment and acceptance steps.
