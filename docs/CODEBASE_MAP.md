# Codebase map

Source inspection: 2026-09-11. This is a navigation guide to the implementation,
not a claim that deployed services or every runtime behavior have been verified.
Refresh the relevant sections when the code changes.

## Product and layout

One Concept teaches one short technical concept per day, with topic follows,
learned history, streaks, likes, saved concepts, and push reminders.

| Area | Entry points and purpose |
| --- | --- |
| Mobile | `mobile/index.ts` registers `mobile/App.tsx`; Expo SDK 57, React Native 0.86, React 19, TypeScript. |
| Backend | `backend/app/main.py`; FastAPI, async SQLAlchemy/asyncpg, Pydantic settings, ES256 JWT verification. Docker uses Python 3.12. |
| Database | `backend/migrations/`; Supabase PostgreSQL schema, RLS, seeds, and incremental migrations. |
| Content engine | `backend/app/services/generation.py`, `pool.py`, `prefetch.py`; Gemini lessons from a curated backlog. |
| Operations | `.github/workflows/`, `backend/railway.json`, `backend/Dockerfile`, `mobile/eas.json`, `mobile/app.config.js`. |
| Documentation | Root `README.md`, `RELEASING.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/ROADMAP.md`, and the backend/mobile guides. |
| Agent guidance | Root `AGENTS.md`; `mobile/AGENTS.md` adds Expo documentation requirements and `mobile/CLAUDE.md` references it. |

## Mobile navigation and presentation

`App.tsx` composes SafeArea, Theme, Connectivity, Auth, and Progress providers.
It holds the native splash until fonts are ready (or fail) and the root lays out.
The visible signed-out flow is `AuthScreen`; authenticated users get bottom tabs
inside a root stack, with a concept-detail modal above them.

| Screen | Responsibility |
| --- | --- |
| `TodayScreen.tsx` | Daily lesson, learned action, streak, loading/exhausted/offline states. |
| `HistoryScreen.tsx` | Learned records and navigation to concept details. |
| `StatsScreen.tsx` | Streak and topic statistics. |
| `ProfileScreen.tsx` | Account, reminder preferences, theme, sign-out, and links to profile subpages. |
| `PersonalizationScreen.tsx` | Server topic catalog and follow controls through `useTopics`. |
| `SavedScreen.tsx` | Recent/cached saved concepts, older metadata pagination, search/category filters, and detail navigation. |
| `ConceptDetailScreen.tsx` | Cached full lesson first, then online refresh by slug; bundled catalog fallback. |
| `AuthScreen.tsx` | Sign-in, sign-up, and password recovery. |
| `AboutScreen.tsx` | Branding and app information. |

All screens live in `mobile/src/screens/`. Reusable presentation in
`mobile/src/components/` covers lesson cards/actions, category/follow controls,
like counts, streak/flame visuals, buttons, skeletons, the offline banner,
`UnavailableState` (animated offline/retry UI), and the What's New card.
`src/theme/index.ts` defines colors, spacing, radii,
typography, shadows, and scaling; `ThemeContext` persists light/dark preference.
`src/navigation.ts` types the root stack.

## Mobile state, persistence, and API boundaries

- `src/lib/supabase.ts` creates the Auth client. `secureStorage.ts` chunks native
  session storage through Expo SecureStore, with AsyncStorage on web.
- `AuthContext.tsx` owns session startup, sign-in/up/recovery/sign-out, supplies
  the API token provider, and triggers push registration and timezone sync.
  `services/authSession.ts` restores cached identity while refresh is pending;
  confirmed sign-out still clears account caches. `authErrors.ts` keeps raw
  transport diagnostics out of authentication forms.
- `src/api/client.ts` makes authenticated JSON requests, exposes `ApiError`, and
  infers connectivity from request results. `ConnectivityContext` drives the
  global banner; there is no native connectivity listener.
  `api/fetchWithTimeout.ts` bounds API and auth fetches to 15 seconds.
- `ProgressContext.tsx` is the shared UI state owner. It loads cached state
  before revalidation, applies optimistic actions, serializes mutation requests,
  and flushes queued work on the same mutation chain. `services/syncLoop.ts`
  retries while offline or actions remain, using 5–30 second backoff, including
  when only some requests succeed. Daily refreshes preserve pending actions;
  account/source changes invalidate them and clear the displayed state. Foreground
  and browser reconnect events wake an idle loop immediately; backgrounding
  pauses timers.
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
  Replay discards stale-day completions, retains retryable failures, and
  reconciles state. It does not backdate server completion.
- `accountCaches.ts` centralizes account cache cleanup. The remote repository's
  epoch guards reject late mutation callbacks after a wipe; the API invalidates
  requests still waiting for an old account's token during cleanup.
  Device theme/demo state is separate from account data.
- `dailyApi.ts` maps server concepts to UI types and clears an old daily cache;
  current daily data arrives in `/v1/me/state`. `conceptApi.ts` persists full
  lessons by slug, including each cached daily lesson and missing saved lessons
  downloaded with three workers. Offline reading requires a completed download.
  `offlineCache.ts` provides per-entry storage and fences late writes on sign-out.
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
- `src/types/index.ts` defines shared concept, progress, daily, history, and
  streak types. API payloads also have types near their service consumers.

## Backend request and service flow

`main.py` configures CORS, routes, production documentation visibility, a shared
JWKS cache, and engine cleanup. Its lifespan owns `db/keepalive.py`'s configurable
database probes; checkout/query and connection return are bounded, failures retry,
and cancellation awaits cleanup before engine disposal. `config.py` loads settings
and normalizes pooler URLs; `db/session.py` creates the async engine/session
dependency and reuses the most recently returned connection to keep a hot slot.
The existing pre-ping, transaction pooler mode, and pool limits remain in place.
`deps.py` obtains identity from bearer tokens verified by `core/security.py`
(ES256, issuer, audience, expiry, and subject). `core/errors.py` formats auth errors.

| Routes (`backend/app/api/v1/`) | Implementation |
| --- | --- |
| `health.py`: `GET /health` | Liveness plus a database query. |
| `topics.py`: `GET /v1/topics` | Active topics, published counts, follow state. |
| `daily.py`: `GET /v1/daily`, `POST /v1/daily/complete` | Selection, completion, server-derived date and streaks. Exhaustion returns 409 with `catalog_exhausted`. |
| `me.py`: `GET /v1/me/state`, `/stats` | Optional compact state, exact totals, today's lesson. |
| `me.py`: `GET /v1/me/history`, `/saved` | Cursor pages through `services/collections.py`; default 50, maximum 100 items. |
| `me.py`: `PUT /v1/me/topics`, `PATCH /v1/me` | Whole-set follows, profile name, PostgreSQL-validated timezone. |
| `me.py`: `GET/PUT /v1/me/notifications`, `POST/DELETE /v1/me/push-token` | Reminder preferences and scoped device registration/removal. |
| `concepts.py`: `GET /v1/concepts/{slug}`, `PUT/DELETE .../like`, `.../save` | Published lesson detail and independent interaction writes. |
| `pages.py`: `GET /confirmed`, `/reset-password` | Public HTML auth landing pages; reset uses Supabase Auth in the browser. |

`router.py` mounts authenticated feature routers under `/v1`. Response/input
models live in `schemas/daily.py`, `me.py`, `notifications.py`, and `topics.py`.

- `services/selection.py` returns an existing assignment first. Otherwise it
  excludes every previously assigned concept, prefers the least recently seen
  followed topic, widens to the global published catalog if needed, and handles
  concurrent inserts. Selection schedules background prefetch, never waits on Gemini.
- `services/state.py` aggregates profile, follows, learned/saved metadata, likes,
  assignment slug, and derived streaks in one SQL statement. The `/me/state`
  handler then calls selection separately to add `daily`; one HTTP request does
  not mean one database statement for the entire endpoint. Compact clients get
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
  with `FOR UPDATE SKIP LOCKED`, publishes validated rows, refunds throttled
  attempts and reclaims stale work. Claims and daily call reservations commit
  together before contacting the provider; quota denial rolls back the claim.
- `services/generation_budget.py` atomically reserves from the shared
  `generation_daily_usage` ledger using PostgreSQL's Pacific calendar day. All
  API prefetch, scheduled refill, and manual rewrite calls share this budget.
  Failed/uncertain calls retain their reservation; restarts do not reset it.
- `services/prefetch.py` schedules bounded background top-ups, with a low unread
  watermark, a published-count target, and per-process in-flight topic tracking.
  Exhausted shared budget is a normal stop condition.
- `services/reminders.py` claims due user/day/time slots before sending Expo push
  batches, handles timezone and midnight windows, suppresses completed days, and
  drops unregistered device tokens. A claimed but failed send can miss a reminder.
- `workers/pool_topup.py` and `workers/reminders.py` are cron entry points.
  `workers/rewrite_catalog.py` is a maintenance command that rewrites existing
  lessons through Gemini with the shared budget and generation kill switch;
  do not run it merely to inspect the project.

## Schema and migrations

`db/models.py` mirrors the SQL schema; migrations are the schema authority.
The eleven tables cover profiles, topics, concepts, user topics, daily assignments,
concept interactions, notification preferences, device tokens, the concept
backlog, reminder logs, and shared daily generation usage. Unique constraints
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

The first nine filenames are recorded in `migrations/applied.txt` in this checkout;
`0010_generation_daily_usage.sql` is pending production application. The ledger
is repository evidence, not an independent check of production. Application
connections use the transaction pooler; migration DDL uses `DIRECT_URL` and the
session pooler. Applied migrations must not be rewritten.

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
  pushes to `develop`; manual dispatch can select a channel. `eas-build.yml` is
  a manual Android build workflow.
- `release.yml` runs on `main`, publishes production then preview OTA, creates a
  version tag/GitHub release, and dispatches `release-apk.yml`. APK publication
  is gated on native `runtimeVersion` changes. Railway deploys the backend
  independently; follow `RELEASING.md` for migration and release ordering.
- `migrations.yml` checks the applied ledger on `main` and PRs into `main`.
  `audit.yml` runs dependency audits, Ruff, and TypeScript checks and files
  findings as issues. `cleanup.yml` manages stale issues; Dependabot schedules
  dependency updates with Expo-managed version restrictions. The checked-in
  workflows do not include a general PR pytest job.
- `mobile/app.config.js` currently has app version `1.7.1` and native runtime
  `1.3.0`; `package.json`'s `1.0.0` is not the release-version authority.

## Documentation drift to remember

These observations are recorded for future assigned work; setup does not change
the implementation or older documentation:

- Backend/architecture prose still describes synchronous on-demand generation;
  selection now schedules background prefetch and widens the stored catalog.
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
