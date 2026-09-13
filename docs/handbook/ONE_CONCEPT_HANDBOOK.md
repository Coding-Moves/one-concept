# 01 | Your app in twelve answers

One Concept is a daily microlearning app: a signed-in learner receives one short technical concept, reads its explanation and example, and can mark it learned, like it, save it, or share it. Topic follows shape future assignments. The backend is the authority for assignments and learning progress.

| Your question | What the inspected code actually does |
| --- | --- |
| Does everyone get the same lesson today? | No shared lesson of the day. Each account receives its own assignment; two accounts can coincidentally receive the same concept. |
| Is selection random? | Partly. It prefers a least recently assigned followed topic, then randomly chooses an eligible concept among the tied candidates. |
| Can my two phones get different daily lessons? | The database permits only one assignment for your account and local date. Both read the stored winner. |
| Is one topic a 25-lesson course? | No. 25 is the default shared published-catalog target for the scheduled generator. It is not a course length or personal allowance. |
| Does reading use up a lesson for everyone? | No. Published content stays in the shared catalog. Each user's assignment history is separate. |
| What happens after my followed topics run out? | The API tries the wider published catalog, excluding anything previously assigned to you. |
| What if I exhaust the entire catalog? | There is no repeat assignment. The app shows an exhausted state until eligible new content exists. |
| Does Gemini answer every app open? | No. It writes stored lessons through background generation paths. Daily requests select database content. |
| What sends learning reminders? | A backend reminder worker calls Expo Push; delivery continues through the platform push service. |
| What sends account emails? | Supabase Auth, through the sender configured in its dashboard. These are separate from learning reminders. |
| Is there a weekly learning digest email? | No implementation was found. This handbook includes a weekly study plan for you. |
| Is this already released? | GitHub confirms v1.8.0 and a successful release workflow. Live device adoption and Railway runtime settings were not checked. |

**Read carefully:** an assigned lesson is treated as consumed by the no-repeat selector even when the learner never marks it learned. Opening the card is also not proof of comprehension. Several current UI phrases say "read" or "learned" more broadly than the backend rule.

Sources: `backend/app/services/selection.py`; `backend/app/config.py`; `mobile/src/screens/TodayScreen.tsx`; `backend/app/services/reminders.py`.

# 02 | The complete system, layer by layer

Think of the system as a shared library with personal reading records. The phone is the reading desk, FastAPI is the librarian, PostgreSQL stores the shelves and records, and Gemini helps write new library content. Supabase Auth supplies identity. GitHub and Expo deliver software updates rather than daily lesson text.

<!-- diagram: architecture -->

| Layer | Responsibility | Where it runs |
| --- | --- | --- |
| Presentation | Screens, cards, navigation, theme, accessibility | The user's phone; web build for development/validation |
| Client state | Cached content, optimistic actions, offline queue | React contexts and device storage |
| Identity | Signup, password sign-in, sessions, account emails | Supabase Auth plus its mobile client |
| Application API | Verify identity; select lessons; write progress | FastAPI/Uvicorn, packaged in Docker for Railway |
| Data | Catalog, follows, assignments, interactions, job records | Supabase PostgreSQL |
| Background work | Generate catalog content and send due reminders | Python workers; API event-loop prefetch |
| Delivery and operations | Git history, reviews, audits, OTA and APK builds | GitHub Actions, EAS, Railway configuration |

**The key boundary:** the mobile app talks directly to Supabase for authentication, and to FastAPI for application data. Gemini and database passwords belong behind the backend boundary. No Firestore, custom payment service, Redis queue, or in-app AI chat appears in the inspected application.

Sources: `mobile/App.tsx`; `mobile/src/lib/supabase.ts`; `mobile/src/api/client.ts`; `backend/app/main.py`; `backend/Dockerfile`.

# 03 | Product vocabulary and learning behavior

The word "card" can mean three different things in this app. Separating them makes the rest of the system much easier to understand.

| Term | Meaning | Does it create another daily lesson? |
| --- | --- | --- |
| Topic/category | A subject such as Computer Science or Mathematics | Following it influences a future unassigned day. |
| Concept/lesson | One catalog row: title, summary, example, topic | It can become an eligible daily assignment. |
| Today's card | The presentation of your assigned concept | Reopening or completing it does not advance to a second daily concept. |
| Assignment | Link between a user, concept and local calendar date | Created on first successful daily/state request for that date. |
| Learned | Assignment with a completion timestamp | Counts toward history and streaks. |
| Like | Personal appreciation, also contributing to a public count | Does not change selection ranking. |
| Save/bookmark | A personal reading collection | Supports revisiting; it is independent of learned status. |
| What's New card | Release highlights bundled with the app version | It announces software improvements, not course content. |

The seeded topics are Artificial Intelligence, Software Engineering, Computer Science, Mathematics, and Linux & Systems. The initial database migration seeds 20 written concepts; a later migration provides 150 curated backlog titles. A backlog title is a writing task, not a published lesson. These are repository seed counts, not a live inventory of production content.

**The learning loop:** choose interests, open the app, read a short explanation and concrete example, mark the day learned, and revisit useful ideas in Saved. This builds a small daily habit. The code does not currently assess understanding with quizzes, enforce prerequisites, adapt difficulty to performance, or schedule spaced-repetition reviews. "Learned" is self-reported completion.

**No chapter progression:** topic rotation is about variety. The selector does not promise lesson 1 before lesson 2, even though a stored difficulty field exists. Someone following only AI receives AI while eligible AI content remains; someone following five subjects receives a mixture.

Sources: `backend/migrations/0003_seed_topics.sql`; `backend/migrations/0004_seed_concepts.sql`; `backend/migrations/0006_seed_backlog.sql`; `backend/app/services/selection.py`; `mobile/src/components/ConceptActions.tsx`.

# 04 | Frontend stack and why each piece exists

The frontend is a TypeScript React Native app built with Expo. It is not a website wrapped inside a phone shell. React describes the interface; React Native supplies native UI components; Expo supplies the development, native-module, build, and update ecosystem.

| Technology | Version declared in this repository | Job in this app |
| --- | --- | --- |
| Expo | ~57.0.20, SDK 57 | Development runtime and managed native integrations |
| React Native | 0.86.3 | Mobile views, input, layout and interaction |
| React / React DOM | 19.2.8 / 19.2.8 | Component state; matching web renderer |
| TypeScript | ~7.0.2 | Compile-time checking of data and component contracts |
| React Navigation | Major 7 packages | Bottom tabs, nested profile stack, detail modal |
| Supabase JS | ^2.116.0 | Auth session lifecycle and password flows |
| AsyncStorage | 2.2.0 | Cached lessons, progress, outbox and preferences |
| Expo SecureStore | ~57.0.3 | Native session storage through a chunking adapter |
| Expo Notifications | ~57.0.17 | Permission, push token, Android channel, foreground display |
| Expo Updates | ~57.0.21 | Compatible downloaded JavaScript updates |
| Native screens / safe area | ~4.26.0 / ~5.7.0 | Navigation integration and screen inset handling |
| Fonts / icons | Space Grotesk; Expo vector icons | Typography and interface icons |

These are manifest declarations. A tilde or caret is a permitted version range; `package-lock.json` resolves the install used by `npm ci`. `mobile/app.config.js` declares the app release as **1.8.0** and its native runtime as **1.3.0**. The package manifest's `1.0.0` is not the release authority.

Styling uses React Native styles and a shared theme module for colors, typography, spacing, radii and shadows. There is no Tailwind, Redux, Zustand, React Query, or Expo Router dependency in the manifest. React contexts and custom repositories handle state and persistence.

**Engineering assessment:** this keeps a small product approachable and avoids a second UI codebase. The tradeoff is that custom caching, reconciliation, navigation, and update compatibility still need deliberate testing; Expo does not make those product rules automatic.

Sources: `mobile/package.json`; `mobile/package-lock.json`; `mobile/app.config.js`; `mobile/src/theme/index.ts`; `mobile/App.tsx`.

# 05 | Screen map: what the learner sees

<!-- diagram: navigation -->

The splash screen stays visible until the custom font is ready or has failed and the root has laid out. Authentication loading follows. A missing session shows Auth; a restored session shows the four main tabs.

| Screen | What it shows | Important detail |
| --- | --- | --- |
| Today | Daily card, explanation/example, learned action, streak, like/save/share | A cached assignment can remain visible offline. A real account never receives an invented demo replacement. |
| History | Recent completed concepts with dates | The visible feed is capped at the last 10, although the backend retains more and exposes pagination. |
| Stats | Current/longest streak, total learned, topic progress | Topic denominators come from the server's published catalog; they can increase as content grows. |
| Profile | Account information, saved count, reminder toggle, theme, sign-out | Reminder times are displayed. The current screen has an on/off switch, not a time editor. |
| Personalization | Dynamic server topics and follow controls | The visible count is shared published concepts, not your personal remaining count. |
| Saved | Saved collection, search and topic filters | Older metadata is paged in; full text must finish downloading before offline reading. |
| Concept detail | Full lesson, example and actions | It can open above any tab; it prefers cached text and refreshes online. |
| About | App and organization information | Separate from account and learning state. |

The authentication screen supports signup, sign-in, password recovery and show/hide password. Password visibility resets on submission or mode change. The root also displays an offline banner and eligible release highlights.

**Beginner distinction:** browsing a saved lesson is not the same as receiving another daily assignment. The daily action records the current eligible day; there is no bulk "complete all 25" course flow. You may revisit content without earning multiple daily completions.

Sources: `mobile/App.tsx`; `mobile/src/screens/TodayScreen.tsx`; `mobile/src/screens/HistoryScreen.tsx`; `mobile/src/screens/ProfileScreen.tsx`; `mobile/src/screens/SavedScreen.tsx`.

# 06 | Startup, state and the first API request

<!-- diagram: startup -->

`App.tsx` nests SafeArea, Theme, Connectivity, Auth, and Progress providers. Each has a distinct job. Theme persists a device preference. Auth restores identity and supplies tokens. Progress is the common state owner so Today, History, Stats and Saved can agree after an action.

**On startup:** the app reads cached identity and progress to paint quickly. It then revalidates through `GET /v1/me/state?compact=true`. That response includes profile data, follows, likes, saves, progress totals, recent collection metadata, and today's full lesson. If today's assignment does not exist, this GET creates it through the normal selector.

One startup HTTP request does not mean the entire screen uses one database query or one network request. The backend performs an aggregate state query and separate daily-selection queries. The app also loads topics, registers push, synchronizes timezone, and may download missing saved bodies. It avoids blocking the initial screen on all those downloads.

**Compact mode:** up to 50 enriched learned rows and 50 saved rows accompany exact totals, continuation cursors and older-topic aggregates. Like/bookmark membership remains complete. Stats adds recent/optimistic entries to older aggregates. Older clients can still use the full legacy response. Saved loads further metadata in pages of 50 when needed.

**UI responsiveness:** tapping Like updates the interface immediately. Network mutations run on a serialized promise chain, so delayed responses cannot casually overwrite later taps. Pending user intentions are merged back into fresh server snapshots. This is optimistic UI with later confirmation, not proof that a write has already reached PostgreSQL.

**Boundary to remember:** `localProgressRepository` and a deterministic bundled selector still exist for local/demo support. Signed-in Today uses server data; the visible signed-out route is Auth. Do not infer the production algorithm from the local prototype helper.

Sources: `mobile/src/context/ProgressContext.tsx`; `mobile/src/services/remoteProgressRepository.ts`; `backend/app/api/v1/me.py`; `backend/app/services/state.py`.

# 07 | Authentication and trustworthy identity

<!-- diagram: auth -->

The app sends the email and password to Supabase Auth using `signInWithPassword` or `signUp`. FastAPI does not store or check those passwords. A successful session provides an access token and refresh machinery. On native platforms the app uses Expo SecureStore with 1,800-character chunks; web uses AsyncStorage.

For an application request, the HTTP client obtains the current access token and attaches `Authorization: Bearer ...`. FastAPI validates the token before deriving the user ID. A user ID supplied in a request body is not an identity claim the server trusts.

| Check | Why it matters |
| --- | --- |
| Algorithm is ES256 | Rejects unsigned tokens and unexpected signing algorithms. |
| Key ID resolves in Supabase JWKS | Uses the project's public verification keys. |
| Issuer matches this project | A token from another issuer is not sufficient. |
| Audience is authenticated | Rejects a token intended for a different audience. |
| Expiry and subject are valid | Expired sessions and missing identity fail verification. |
| Queries use the verified user | Protects one user's progress from another user's request. |

JWKS is a public key set, not the signing secret. The backend caches it for an hour and throttles refreshes for unknown key IDs to 30 seconds. The legacy HS256 secret setting is declared but not used by the current verifier.

**Offline session recovery:** a cached identity can unlock already-cached browsing during a retryable refresh failure. It cannot make the API accept an invalid token. There is an eight-second startup failsafe; network/auth fetches use a separate 15-second timeout.

**Sign-out:** the app tries to deregister this phone's push token before revoking the session. If global sign-out fails offline, it falls back to local sign-out. Account caches and queued intentions are cleared, with guards against late callbacks. Already-issued access-token validity is still governed by its verification/expiry rules; the backend does not perform a revocation lookup on every request.

Sources: `mobile/src/context/AuthContext.tsx`; `mobile/src/lib/secureStorage.ts`; `mobile/src/services/authSession.ts`; `backend/app/core/security.py`; `backend/app/deps.py`.

# 08 | Account emails: trigger, template and delivery

There are three separate decisions in an account email: **why it is triggered**, **what it looks like**, and **which service delivers it**. Supabase Auth owns the trigger. Repository HTML supplies the design after manual installation. The configured SMTP sender handles delivery.

<!-- diagram: email -->

| Email | Trigger | Current integration |
| --- | --- | --- |
| Confirm signup | Signup when email confirmation is enabled | `confirm-signup.html`; verified link then confirmation landing page |
| Reset password | User selects Forgot password and submits an address | `reset-password.html`; verified recovery link to a browser form |
| Password changed | A completed password change, with Supabase security notification enabled | `password-changed.html`; informational security email |
| Weekly learning digest | No current worker, template or preference found | A possible future feature, not part of these Auth emails |

The work log records that the owner installed all three templates and enabled the password-change notification. That is reported operational evidence; this task did not inspect the live dashboard or send test emails. Actual inbox delivery remains unverified.

**Which provider are we using?** The app integration is Supabase Auth. The current SMTP provider cannot be proven from repository code. The work log mentions an existing Gmail setup that needs configuration/testing; Resend setup remains a separate open draft, PR #187. There is no active Resend SDK/API call in the inspected backend. It would be inaccurate to say the app definitely sends through Resend today.

As checked in the provider documentation, Supabase's default sender is intended for testing, restricts recipients to project-team addresses, and currently permits two messages per hour. Custom templates do not remove those limits. A configured custom SMTP service changes the transport; it does not require rewriting the mobile signup flow. [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

Merging HTML into GitHub or publishing an app release does not install the templates. Supabase dashboard changes and a controlled inbox test are separate operational steps.

Sources: `docs/EMAIL_TEMPLATES.md`; `backend/email-templates/`; `mobile/src/context/AuthContext.tsx`; `docs/WORK_LOG.md`.

# 09 | Signup and password reset, end to end

<!-- diagram: recovery -->

**Signup:** Supabase creates the Auth user. The database's `on_auth_user_created` trigger initializes the profile, notification preferences and default follows. With confirmation enabled, signup may return a user but no authenticated session. The UI asks the person to check email. The verified link redirects to the configured Site URL, intended to be the backend's `/confirmed` page, which tells them to return to the app and sign in.

**Recovery:** the app calls `resetPasswordForEmail` with the API's absolute `/reset-password` URL when configured. The response stays neutral about whether an account exists. Supabase verifies the emailed link and redirects to the browser page with recovery information in the URL fragment.

The page reads the fragment, checks `type=recovery`, and submits the new password directly to Supabase's `/auth/v1/user` endpoint. It uses the public anon key plus the recovery access token. The fragment is not sent as part of the normal HTTP request to FastAPI. After success, the page removes it from browser history and directs the person back to sign-in. The page also handles invalid or expired links and mismatched passwords.

| Operational item | Why it must be correct |
| --- | --- |
| Supabase Site URL | Signup must land on a meaningful page after verification. |
| Allowed redirect URLs | Recovery must be permitted to reach this backend's `/reset-password`. |
| Backend SUPABASE_ANON_KEY | The browser form needs public Auth client configuration; otherwise it shows reset unavailable. |
| Template ConfirmationURL placeholder | The button must visit Supabase verification, not jump straight to a success page. |
| Security notification toggle | Password-change email is independent of the reset email. |

There is no configured native URL scheme in the inspected app config. These flows use HTTPS landing pages and explicit return-to-app instructions; they are not a fully automatic deep-link sign-in flow.

Sources: `backend/app/api/v1/pages.py`; `mobile/src/context/AuthContext.tsx`; `backend/migrations/0001_schema.sql`; `docs/EMAIL_TEMPLATES.md`.

# 10 | Credentials: what is used, where and why

This inventory names settings and credentials without displaying their values. A URL, app identifier, public project key, user session token and server secret have different security roles.

| Name or credential | Location and consumer | Classification / purpose |
| --- | --- | --- |
| EXPO_PUBLIC_API_BASE_URL | EAS/mobile build environment; HTTP client | Public backend address; not a password |
| EXPO_PUBLIC_SUPABASE_URL | Mobile Auth client | Public project address |
| EXPO_PUBLIC_SUPABASE_ANON_KEY | Mobile Auth client | Public project key; not a logged-in identity |
| SUPABASE_URL / SUPABASE_JWKS_URL | Backend config / JWT verifier | Public project and verification-key endpoints |
| SUPABASE_ANON_KEY | Backend reset page | Public Auth key intentionally emitted into that page |
| DATABASE_URL | Railway API/workers | Secret PostgreSQL connection; application transaction pooler |
| DIRECT_URL | Migration/operator environment | Secret database connection for DDL; configured session connection |
| GEMINI_API_KEY | Backend generation paths | Secret provider credential; sent in x-goog-api-key header |
| EXPO_TOKEN | GitHub Actions secret | Allows EAS CLI to build/publish; not a learner's push token |
| GITHUB_TOKEN | Ephemeral Actions token | Workflow permissions for releases, dispatch and audit issues |
| User access / refresh tokens | Auth session storage | Sensitive account credentials; never publish them |
| Expo push token | Phone and device_tokens table | A sensitive delivery address, not a login credential |

`SUPABASE_SERVICE_ROLE_KEY` and `SUPABASE_JWT_SECRET` are declared optional settings, but searches found no current consumers beyond their declarations. FastAPI connects using `DATABASE_URL`, not a service-role REST client. The active JWT verifier uses ES256/JWKS.

Android configuration references `google-services.json`. Firebase service-account credentials for FCM/EAS are private and distinct from client Firebase configuration. Their presence or validity in EAS was not inspected. iOS push would require Apple credentials; the checked-in automated build flow targets Android.

SMTP host, user, password/API credential and sender identity live in the email provider/Supabase setup, not the app bundle. No `RESEND_API_KEY` is consumed by current app code. All `EXPO_PUBLIC_*` values are readable from the bundle, so they must never hold backend secrets. Public keys identify an application; JWTs identify a user. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Sources: `backend/app/config.py`; `backend/.env.example`; `mobile/.env.example`; `mobile/app.config.js`; `.github/workflows/release.yml`.

# 11 | Backend stack and request lifecycle

FastAPI is the application's trusted rule layer. It accepts HTTP/JSON, validates input, verifies the caller, runs service logic, and reads/writes PostgreSQL. Uvicorn is the web server that runs the application. Docker packages that Python process for Railway.

<!-- diagram: backend -->

| Component | Pinned version | Purpose |
| --- | --- | --- |
| Python | 3.12 Docker base | Backend language/runtime |
| FastAPI | 0.141.1 | Routing, dependency injection, response contracts |
| Uvicorn | 0.52.4 | ASGI HTTP server |
| SQLAlchemy async | 2.0.52 | Sessions, pooling and async SQL execution |
| asyncpg | 0.31.0 | PostgreSQL network driver |
| Pydantic Settings | 2.15.0 | Environment configuration; schemas use Pydantic models |
| PyJWT with crypto | 2.13.0 | ES256 signature and token-claim validation |
| httpx | 0.28.1 | HTTP calls to Gemini, Expo and Supabase JWKS |
| pytest / pytest-asyncio | 9.1.1 / 1.4.0 | Unit, API and asynchronous integration tests |

The structure separates routes (`api/v1`), request/response schemas, service logic, database session setup, and workers. Many services use explicit SQL through SQLAlchemy's `text()` rather than hiding the selection and concurrency rules behind ORM queries. ORM models mirror the schema; SQL migrations are the authority.

Configuration comes from environment variables, with local `.env` support. Missing required database or Auth settings fail startup. CORS controls allowed browser origins; it is not a replacement for authentication. Production disables the interactive docs and raw OpenAPI route. `/health` includes a database query, so it checks more than whether a Python process exists.

The default container listens on Railway's `PORT`, falling back to 8000. Railway configuration declares Docker builds, a `/health` check with a 30-second timeout, and failure restarts up to three retries. These files describe deployment behavior; they do not prove current service health or deployment settings.

Sources: `backend/requirements.txt`; `backend/requirements-dev.txt`; `backend/app/main.py`; `backend/app/db/session.py`; `backend/Dockerfile`; `backend/railway.json`.

# 12 | API map: screen actions become requests

The `/v1` feature API is authenticated. The backend derives user identity from the verified token, so the phone does not choose the account whose data gets changed.

| Method and path | Use / result |
| --- | --- |
| GET /health | Public service and database health |
| GET /confirmed; /reset-password | Public human-facing Auth landing pages |
| GET /v1/topics | Active topics, global published counts and your follow state |
| GET /v1/me/state?compact=true | Startup snapshot plus today's full lesson; may create today's assignment |
| GET /v1/daily | Get/create today's assignment; 409 catalog_exhausted if no candidate |
| POST /v1/daily/complete | Mark the most recent eligible assignment learned; return its day and streaks |
| GET /v1/me/stats | Current/longest streak and total learned |
| GET /v1/me/history | Cursor-paged completed history |
| GET /v1/me/saved | Cursor-paged saved metadata |
| PUT /v1/me/topics?compact=true | Replace the whole followed-topic set |
| PATCH /v1/me?compact=true | Update display name and/or validated timezone |
| GET / PUT /v1/me/notifications | Read or replace reminder preferences |
| POST / DELETE /v1/me/push-token | Register/reassign or remove a device's push token |
| GET /v1/concepts/{slug} | Read a published lesson's full content |
| PUT / DELETE /v1/concepts/{slug}/like | Set or clear the caller's like |
| PUT / DELETE /v1/concepts/{slug}/save | Set or clear the caller's bookmark |

Collection endpoints default to 50 rows and permit 1-100. History uses a date cursor; Saved uses a timestamp/UUID ordering cursor so ties can be traversed. These are live views, not frozen snapshots; a refreshed first page discovers new records above an older cursor.

**Error meanings:** 401 means the request is not authorized by a valid session; 400 can mean invalid topics, timezone or cursor; 404 can mean a missing lesson/assignment; 422 is input-schema validation; 409 is daily catalog exhaustion; 5xx is a server failure. The client also represents transport failure as status 0, which is not an HTTP status returned by the server.

`/me/state` keeps the rest of the account usable by returning `daily: null` on exhaustion instead of failing the entire response. Like/save requests confirm the requested state. Repeating a save remains saved, although the backend may refresh its timestamp; state idempotency does not mean all metadata is byte-for-byte unchanged.

Sources: `backend/app/api/v1/`; `backend/app/schemas/`; `backend/app/services/collections.py`; `mobile/src/api/client.ts`.

# 13 | Database relationships: shared content, personal state

<!-- diagram: database -->

PostgreSQL stores relationships, not a separate copy of every lesson for every person. A concept row belongs to one topic. A daily assignment points from a user to that concept and a date. Two users can point to the same concept without sharing completion status.

| Table group | Tables | Scope |
| --- | --- | --- |
| Identity bridge | profiles, linked to Supabase auth.users | One app profile per Auth identity |
| Shared learning content | topics, concepts | Shared catalog and content provenance |
| Personal learning choices | user_topics | Many users follow many topics |
| Personal daily progress | daily_assignments | One user's concept/date/completion |
| Personal interactions | concept_interactions | Independent liked_at and saved_at on one user/concept row |
| Reminder configuration | notification_preferences, device_tokens | Per-user settings and one or more handsets |
| Generation operations | concept_backlog, generation_daily_usage | Shared writing queue and daily call budget |
| Reminder operations | reminder_log | Claimed user/date/time slots |

There are eleven application tables in the inspected migrations, plus Supabase's managed Auth tables. UUIDs are database identifiers; stable slugs such as `hash-tables` identify lessons in API paths and mobile state.

**Example:** Concept C is stored once. Ali's assignment references C with a completion timestamp; Sara's assignment references C with no completion. Ali's like and Sara's bookmark are separate interaction records. Neither action edits the lesson body. Public like totals aggregate likes across accounts, while the API excludes the viewer's own like and the UI adds it locally for immediate feedback.

This model makes shared generation economical and per-user progress clear. It also means changing a published concept changes the shared content readers may see on later refresh. Cached copies can stay older until refreshed.

Sources: `backend/migrations/0001_schema.sql`; `backend/migrations/0005_concept_backlog.sql`; `backend/migrations/0007_reminder_log.sql`; `backend/migrations/0010_generation_daily_usage.sql`; `backend/app/db/models.py`.

# 14 | Database guarantees, triggers and migrations

| Rule | Enforcement | Why it matters |
| --- | --- | --- |
| At most one assignment per user/day | UNIQUE(user_id, assigned_for) | Two devices cannot give the account two daily slots. |
| Never reassign a concept to one user | UNIQUE(user_id, concept_id) | No-repeat survives races and application mistakes. |
| Stable concept identity | Unique concept slug | Prevents duplicate catalog slugs. |
| One follow per user/topic | Composite primary key | Repeated follows do not duplicate rows. |
| Independent like/save state | One interaction per user/concept | Liking does not automatically save or complete. |
| One reminder claim per slot | Primary key(user_id, local_date, slot) | Overlapping workers do not separately claim the same reminder. |
| Nonnegative generation usage | Daily primary key and check constraint | Atomic shared counter is durable across process restarts. |

**Actual SQL triggers:** inserting `auth.users` runs `handle_new_user`, which creates a profile, default reminders, and follows for all active topics at that time. Several tables run `touch_updated_at` before updates. A backend bootstrap helper is a fallback when state loading finds no profile.

**What is not a SQL trigger:** lesson reading does not call Gemini through PostgreSQL. Notifications are not sent by a database email trigger. Generation and reminder decisions are Python logic invoked by a request/background task or an external cron schedule.

Row Level Security is enabled. Client policies limit access by owner or published/active state. Operational tables have no client policies. The privileged backend connection can bypass those client protections, so every backend query still needs correct user scoping. RLS does not repair a backend query that uses a privileged connection and forgets its ownership filter.

Migrations are ordered SQL files: core schema and RLS; topic/lesson seeds; backlog schema/seeds; reminder claims; stale-generation timestamps; like index; shared generation budget. Applied files are immutable. A new schema change needs a new migration, not an edit to old history.

The production ledger lists all ten SQL filenames. Migration 0010's actual application and independent verification are recorded in the work log. Deployment does not apply migrations automatically. The GitHub check compares filenames with the ledger; it does not connect to production and prove the schema. Verification must happen before recording a filename as applied.

Sources: `backend/migrations/`; `backend/app/services/users.py`; `.github/workflows/migrations.yml`; `RELEASING.md`; `docs/WORK_LOG.md`.

# 15 | The exact daily-selection algorithm

<!-- diagram: selection -->

1. PostgreSQL derives today's calendar date using the user's stored profile timezone. Production callers cannot supply an arbitrary assignment date.
2. If today's assignment exists, return it unchanged. Completion, refreshes and follow changes do not replace it.
3. Find published concepts in followed topics, excluding **every concept ever assigned** to this account, including unfinished assignments.
4. Prefer topics with the oldest last-assigned date; never-seen topics come first. Use SQL `random()` to break ties among eligible concepts.
5. If the followed pool is empty, request background refill for an eligible stale followed topic, then immediately search the global published catalog with the same no-repeat rule.
6. If no global candidate exists, return exhausted. Otherwise insert the assignment. A uniqueness conflict lets the concurrent winner's row be returned.
7. After a new followed-topic assignment, count that user's remaining unassigned content in its topic. At five or fewer, request background prefetch.

**Random does not mean reshuffle on refresh.** Randomness is used when creating the assignment. Persistence makes the result stable for the date. Topic rotation reduces the chance that a huge topic dominates a small one; it is not a fixed weekday schedule or a strict 20% quota.

The first fallback response sets `outside_followed_topics=true`. That flag is not stored with the assignment; the existing-assignment branch returns false on later fetches, so the explanatory banner can disappear while the assigned lesson stays the same.

Selection does not rank by likes, reading speed, quiz performance or difficulty. It does not call a language model to decide what a particular person needs next. It is a deterministic rule order plus a random tie-break, followed by a durable database assignment.

Sources: `backend/app/services/selection.py`; `backend/app/api/v1/daily.py`; `backend/app/api/v1/me.py`; `backend/migrations/0001_schema.sql`.

# 16 | Two users, one week: same or different?

This is an illustrative valid outcome, not a prediction or a dump of real user records. Ali follows AI and Mathematics. Sara follows Software Engineering only. Both are new, open the app each listed day, and have sufficient eligible content.

| Day | Ali's possible assignment | Sara's possible assignment |
| --- | --- | --- |
| Monday | AI: Overfitting | Software: Idempotency |
| Tuesday | Mathematics: Bayes' theorem | Software: ACID transactions |
| Wednesday | AI: Tokenization | Software: Connection pooling |
| Thursday | Mathematics: Eigenvectors | Software: Retries and backoff |
| Friday | AI: Transfer learning | Software: Dependency injection |
| Saturday | Mathematics: Gradient descent | Software: Feature flags |
| Sunday | AI: Regularization | Software: Database migrations |

<!-- diagram: multiuser -->

Ali's first topic could instead be Mathematics. Rotation uses his assignment history, so Sara's reading does not change which topic is least recent for him. If two people follow the same subjects and have similar history, they can get the same or different concepts. A concept is not reserved globally when one person receives it.

**Different start dates:** a new user can receive a lesson that an older user finished months earlier. The new user does not inherit the older user's progress, and the app does not force everyone to read the newest generated concept.

**Changing follows:** if Ali unfollows AI after Monday's card is created, Monday remains assigned. The next unassigned day uses the updated followed set. If every followed topic is exhausted, the global fallback can give a lesson outside that set. Following no topics also leads to the global fallback; it is not a way to disable the daily assignment.

**Adding content:** a newly published concept becomes a candidate for everyone who has never been assigned it. Existing assignments stay pinned. A user without today's assignment can receive new content on a later request, including later that same day after an earlier exhausted response.

Sources: `backend/app/services/selection.py`; `backend/app/services/interactions.py`; `backend/app/schemas/me.py`.

# 17 | Completion, missed days and streaks

<!-- diagram: completion -->

Marking learned writes `completed_at` with the server clock. Repeating the completion call preserves the existing timestamp. A completion normally applies to today; the API can complete yesterday only if there is no newer assignment and yesterday is still the most recent eligible day. Older dates cannot be backfilled through this endpoint.

| Situation | Result |
| --- | --- |
| Read today's card and tap learned twice | One completed assignment; no extra lesson and no double streak credit. |
| Open a card but never mark it learned | It stays uncompleted, yet no-repeat excludes it from future assignments. |
| Never open the app that day | No assignment is created merely by midnight or by the reminder worker. |
| Read at 23:58, complete at 00:01 with no new assignment | The API can credit yesterday's assignment. |
| A new day's assignment already exists | Completion targets that newer assignment, not yesterday's card. |
| Queue an offline completion then reconnect next day | The mobile replay code drops the stale-day action; it does not backfill the streak. |
| Save or like an old lesson | It changes the interaction, not daily learning credit. |

Streaks are derived from completed `assigned_for` dates, not a mutable counter supplied by the phone. Consecutive dates form runs. The current streak can end today **or yesterday**, so an unfinished morning does not immediately break a streak. A full missed day creates a gap. The longest streak is the longest historical run.

Example: completed Monday, Tuesday and Wednesday; Thursday is unfinished. During Thursday, current remains 3. If Friday arrives with Thursday still missed, current is 0 until a new run begins; longest remains 3. Completing Friday yields current 1 and total learned 4.

Changing timezone changes future day boundaries; existing `assigned_for` dates are not rewritten. The device sends its IANA timezone on sign-in/session activation as best effort. PostgreSQL validates the zone. A failed sync can leave UTC or an older zone until a successful later sync; changing the phone clock is not the server's source of truth.

Sources: `backend/app/services/interactions.py`; `backend/app/services/streaks.py`; `mobile/src/services/remoteProgressRepository.ts`; `mobile/src/services/notifications.ts`.

# 18 | What really happens after all 25 lessons

**This is the main catalog-growth limitation found in the source.** The system measures a user's remaining lessons to request prefetch, but the generator's stopping rules measure the total shared published catalog. Reading a concept never removes it from that total.

<!-- diagram: exhaustion -->

| Quantity | Current rule | Example after Ali finishes a 25-concept topic |
| --- | --- | --- |
| Shared published count | Number of published concept rows in the topic | Still 25 |
| Ali's unassigned count | Published concepts never assigned to Ali | 0 |
| Sara's unassigned count | Same calculation for Sara | Could still be 20 if she has received 5 |
| Scheduled top-up target | MIN_POOL_PER_TOPIC, default 25 | Deficit = 25 - 25 = 0; no generation |
| Prefetch trigger | Personal unassigned count is at most 5 | Can request a job |
| Prefetch stop target | Shared published count reaches 10 | 25 already exceeds 10; job stops without a new lesson |

So "I finished 25; the system automatically adds the next 25" is **not** the implemented behavior. Even on Ali's twentieth assignment, when five remain, requesting prefetch can do no work because the global shelf already holds 25. A pending backlog and a working Gemini key do not override this stop condition.

On the next unassigned day, Ali gets an eligible concept from another followed topic if possible. When all followed topics are dry, the selector widens to other published topics. If the whole catalog is exhausted for Ali, `/v1/daily` returns 409 and `/me/state` returns `daily: null`. Sara continues receiving her own eligible lessons normally.

The exhausted UI says new concepts are on the way, but current code does not guarantee when new content will arrive. This conclusion is a direct source-based deduction, not a production experiment or a change made in this task.

**Possible future fix:** base replenishment on a defined reserve of unassigned lessons for active readers, or an explicit publishing cadence, while retaining the shared budget and bounded work. Raising the shared target can add content temporarily, but it still does not model each user's remaining runway.

Sources: `backend/app/services/prefetch.py`; `backend/app/services/pool.py`; `backend/app/services/selection.py`; `backend/app/config.py`; `mobile/src/screens/TodayScreen.tsx`.

# 19 | Content generation: from title to published lesson

<!-- diagram: generation -->

Gemini writes explanations for curated subjects; it does not choose the syllabus. A backlog row supplies a stable slug, title, topic, optional angle and difficulty. The generator asks for JSON containing a summary and example. The model setting defaults to `gemini-3.1-flash-lite`; a runtime environment can override it.

| Stage | Actual behavior |
| --- | --- |
| Entry point | Scheduled pool_topup, request-triggered prefetch, or deliberate rewrite_catalog maintenance |
| Claim | Oldest eligible pending title, fewer than 3 attempts; PostgreSQL row locking skips work claimed by another worker |
| Budget | Reserve a shared daily call slot in the same transaction as the claim |
| Commit | Commit before the provider request so a DB transaction is not held while the model writes |
| Provider request | httpx POST to Gemini generateContent, with a 45-second timeout |
| Prompt | Version 2026-08-v2; short everyday explanation and one concrete example |
| Validation | JSON shape, required text, length limits, no specified filler/meta openings or code fences |
| Publication | Insert published concept with model/prompt provenance; mark backlog done only if insertion succeeded |

The request uses temperature 0.7, up to 800 output tokens and a JSON response schema. Validation requires a 100-420 character summary and a 40-300 character example. It rejects identical summary/example text and selected undesirable phrasing. These checks improve formatting; they do not establish factual correctness or expert educational review. Valid output is published automatically.

Scheduled refill compares active topics with `MIN_POOL_PER_TOPIC` and fills deficits subject to backlog, switches and budget. The backend README recommends a daily Railway job but does not commit a precise live cron schedule. Request-triggered prefetch is an `asyncio` task inside the API process, deduplicated by topic in that process, with at most five generated lessons and a global published target of ten.

A new published lesson needs no mobile release. It appears through API data on a later request. Generation success does not itself send a "new content" push, change today's pinned assignment, or create a new topic.

Sources: `backend/app/services/generation.py`; `backend/app/services/pool.py`; `backend/app/services/prefetch.py`; `backend/app/workers/pool_topup.py`.

# 20 | Generation budget, retries and failure states

<!-- diagram: budget -->

The default **200-call cap** is an application limit shared across API prefetch, scheduled refill and catalog rewrites. It is not a guaranteed Gemini allowance, a user limit, or a token/spending cap. The database reserves one slot before each attempted call. Every process must use the same configured cap.

The budget day is PostgreSQL's current date in `America/Los_Angeles`, matching Gemini's documented midnight Pacific RPD reset. During Pacific daylight time that is 12:00 in Karachi; during Pacific standard time it is 13:00. The learner's midnight is a different clock. Provider limits also depend on project, model and tier; multiple keys for the same project do not create independent provider quotas. [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits).

| Outcome | Backlog consequence | Shared budget consequence |
| --- | --- | --- |
| No eligible backlog | No title claimed | No reservation |
| Budget denied or claim commit fails | Claim and attempt roll back | No committed call slot |
| Valid lesson | Mark done after actual insert | Reserved slot remains spent |
| Invalid response/provider failure | Return pending or retire after 3 attempts | Committed slot remains spent |
| Provider 429 | Return pending and refund backlog attempt | Daily slot is still spent |
| Crash after commit | Row may remain generating | Slot remains spent; later top-up can reclaim stale work |
| Slug collision on publication | Mark failed; no new concept | Call was already spent |

Scheduled top-up reclaims generating rows older than 30 minutes or with a missing claim time. Its rate-limit retry starts at 15 seconds, doubles up to a 120-second backoff component, respects a longer provider delay, and stops after five consecutive rate limits. Normal scheduled pacing defaults to six seconds between calls. Prefetch stops on a rate limit and has no equivalent pacing loop.

**Safety controls:** generation defaults off; it needs the master enable switch and key. Prefetch also needs `GENERATION_ON_DEMAND`. A cap of zero blocks new reservations. These settings stop new work; they cannot recall an already-sent request. No distributed per-minute rate limiter is implemented, so parallel processes may still hit provider RPM limits below the daily cap.

Sources: `backend/app/services/generation_budget.py`; `backend/app/services/pool.py`; `backend/app/services/prefetch.py`; `backend/app/workers/rewrite_catalog.py`; `backend/app/config.py`.

# 21 | Adding more lessons and new topic cards

There are three different expansion jobs: writing another lesson in an existing topic, adding a new topic, and announcing an app release. They use different data and do not automatically trigger one another.

<!-- diagram: growth -->

**More lessons in an existing topic:** add reviewed, unique backlog subjects through the repository's migration/operational process. A generator can turn them into published concepts only when the switches, target/deficit rule and budget permit it. Adding pending titles alone does not make them visible. The current shared-count limitation still applies even with a large backlog.

**A new topic:** add an active topic row with a stable slug, display name, description and sort order; provide actual published content or eligible backlog and generation configuration. `GET /v1/topics` supplies the topic to Personalization and Stats. The mobile UI reads this dynamic list, so a basic new topic does not inherently require an APK. New styles or features may require client work.

The new-user trigger follows every active topic **when that account is created**. It does not automatically add a later topic to all existing users. Existing users can choose to follow it. Global fallback may still select from it after their followed catalog is exhausted. Topic appearance and default follow policy are separate choices.

**What counts change?** A published addition raises the topic's shared count. A learner at 25/25 can later show 25/30 without losing a completion. This is a larger denominator, not a reset. A draft, failed backlog row or archived concept is not a new published candidate.

| Change | Needs new content data? | Needs app release? | Automatically sends push? |
| --- | --- | --- | --- |
| Another lesson, existing shape | Yes | Usually no | No |
| Another basic topic | Yes | Usually no | No |
| New daily-card UI | Not necessarily | Yes, usually OTA if compatible | No |
| Native permission/module | Not necessarily | New native build/runtime | No |
| Release highlights | Bundled highlights entry | Yes | No; displayed in app |

There is no built-in admin CMS or mobile "add topic" screen in this repository. Extending the syllabus is an operator/developer activity. A future editorial tool should preserve unique slugs, review status and the generation budget.

Sources: `backend/migrations/0001_schema.sql`; `backend/migrations/0006_seed_backlog.sql`; `backend/app/api/v1/topics.py`; `mobile/src/hooks/useTopics.ts`; `mobile/src/screens/StatsScreen.tsx`.

# 22 | Push registration and the delivery chain

<!-- diagram: push -->

On account activation, the mobile Auth effect starts reminder registration as best effort. The code requires `Device.isDevice`, requests notification permission if needed, creates Android's `reminders` channel at high importance, gets an Expo push token using the EAS project ID, and sends it to FastAPI.

The backend stores that token in `device_tokens`, scoped to the authenticated user. A unique token can move to a new user when the same handset signs into another account. A user can have several tokens, so a single reminder slot can fan out to several devices.

The backend sends to Expo's HTTPS push endpoint. Expo handles the downstream platform services: FCM for Android and APNs for iOS. Firebase here is a notification delivery dependency, not the application's main database or authentication provider. The inspected workflow automates Android distribution; source-level iOS support does not prove a working shipped iOS build. [Expo push overview](https://docs.expo.dev/push-notifications/overview/).

| Layer | Responsible for |
| --- | --- |
| User and phone OS | Permission, app/channel settings, focus modes and final display |
| Mobile code | Register token and configure foreground presentation/channel |
| FastAPI and PostgreSQL | Store token and account reminder preferences |
| Reminder worker | Decide which user/time slots are due |
| Expo Push | Accept messages and route to platform push infrastructure |
| Platform service | Deliver to the registered application/device |

The payload contains a generic title/body, default sound, high priority and the Android channel ID. It contains no lesson slug or custom navigation data. No custom notification-response navigation handler was found; the code does not guarantee a tap routes to a particular lesson screen.

If a notification arrives while the app is open, the handler shows the banner/list quietly: no sound and no badge update. If it arrives while closed, the app need not be executing a JavaScript timer for the OS to show a remote push. Device and delivery settings can still suppress or delay it.

Sources: `mobile/src/services/notifications.ts`; `mobile/src/context/AuthContext.tsx`; `backend/app/api/v1/me.py`; `backend/app/services/reminders.py`; `mobile/app.config.js`.

# 23 | The reminder worker's exact decision

<!-- diagram: reminders -->

`python -m app.workers.reminders` runs one pass and exits. Its documented cadence is every 15 minutes on Railway, with a matching 15-minute look-back window. The actual schedule is configured outside the checked-in `railway.json`; it was not inspected live in this task.

For every enabled user's stored reminder times, the SQL considers occurrences on both today and yesterday in that user's timezone. A slot is due if it is at or before local now and strictly later than now minus 15 minutes. This handles slots near midnight without wrapping bare time values incorrectly.

The worker requires at least one registered device and skips a completed scheduled date. It also suppresses yesterday's late slot when the current day has already been completed. It does **not** require an existing daily assignment or available content. A user who has not opened the app, or has exhausted the catalog, can therefore still qualify for the generic reminder.

The due slots are atomically inserted into `reminder_log` with conflict handling. Only the slots won by this pass are sent. Claims commit before network delivery. Messages fan out to registered devices in batches of at most 100 with a 30-second HTTP timeout.

| Result | Current handling |
| --- | --- |
| Expo ticket status ok | Increment the accepted/sent counter |
| DeviceNotRegistered ticket | Remove that stale device token |
| Other ticket rejection | Log it |
| HTTP batch failure | Log and continue; the slot remains claimed |
| Overlapping worker or rerun | Existing primary key prevents a second claim |

**Guarantee:** this favors one server claim/attempt per slot over retrying until delivered. It is not end-to-end exactly-once phone delivery. A crash or failed batch after the claim can miss a reminder. The code processes initial tickets but does not poll Expo delivery receipts, and the `sent_at` column is stamped when claimed rather than proving handset display.

Completion can race with an already-claimed batch. It suppresses later decisions; it cannot retract a push already sent. The generic copy should be understood in that light.

Sources: `backend/app/services/reminders.py`; `backend/app/workers/reminders.py`; `backend/migrations/0007_reminder_log.sql`.

# 24 | Notification timing: a day in Karachi

Defaults are **08:00, 14:00 and 20:00 in the profile timezone**, with reminders enabled. The API accepts one to three unique valid HH:MM values. The current Profile UI displays those times and an enabled switch; there is no custom-time editor on that screen.

<!-- diagram: reminder_day -->

| Example | Expected server behavior |
| --- | --- |
| 08:00, day unfinished | A due worker pass can claim and send the morning reminder. |
| 08:10, learner completes online | Completion becomes authoritative in PostgreSQL. |
| 14:00 and 20:00 afterward | Those slots are suppressed because the date is complete. |
| Learner completes at 15:00 instead | Morning and afternoon can have sent; evening is suppressed. |
| Learner never completes | Up to three configured slot claims per day, each sent to all registered devices. |
| Completion only exists offline at 13:55 | Server may still send at 14:00 until the queued completion reaches it. |
| User disables reminders online | Future due queries exclude that user; an already-sent message may remain. |
| Slot at 23:58; worker runs at 00:05 | Yesterday's occurrence lies inside the window and may be sent, unless completion suppresses it. |

For `Asia/Karachi`, 08:00 corresponds to 03:00 UTC, 14:00 to 09:00 UTC and 20:00 to 15:00 UTC. Railway's scheduler uses UTC, but the SQL translates the clock per user; you do not create a separate cron job per timezone. A 14:07 custom slot would normally be caught by the next suitable pass, not necessarily at exactly 14:07.

Railway documentation says cron timing can vary and a new run is skipped if the previous run is still active. If a pass is delayed beyond the 15-minute look-back, a slot can be missed; this implementation has no unlimited catch-up. A worker must close resources and exit. [Railway cron jobs](https://docs.railway.com/cron-jobs).

**Different clocks:** progress and reminders use the profile's local calendar day; the generation budget uses Pacific day; GitHub audit schedules use UTC. These clocks should never be substituted for one another.

Sources: `backend/migrations/0001_schema.sql`; `backend/app/schemas/notifications.py`; `backend/app/services/reminders.py`; `mobile/src/screens/ProfileScreen.tsx`.

# 25 | Every major trigger, compared

| Event or condition | What runs | Observable effect / limit |
| --- | --- | --- |
| New Supabase Auth user row | Database bootstrap trigger | Profile, default reminders and active-topic follows |
| Signup needing confirmation | Supabase Auth email system | Confirmation email through configured sender |
| Forgot password | Supabase Auth recovery flow | Reset email, then web password form |
| Successful password change | Enabled Supabase security email | Informational account notification |
| App session activates | Mobile Auth effect | Push registration and timezone sync, best effort |
| First daily/state request on a new local date | Daily selection service | Persist a new eligible assignment |
| Five or fewer personal unassigned concepts in the selected followed topic | API background prefetch request | May generate if shared count, switches, backlog and budget allow |
| Followed catalog exhausted | Prefetch request plus global fallback | Existing global content serves today; generation is not awaited |
| Scheduled pool worker | Shared catalog deficit calculation | Publish enough eligible backlog toward the configured target |
| Due reminder time, incomplete day | Reminder worker | Claim slot then send generic Expo pushes |
| Online learned action | Completion service | Store completion; later reminder decisions become silent |
| Reconnect or reopen with queued work | Mobile sync loop | Replay and reconcile while the app is active |
| Native app goes to background | Mobile lifecycle listener | Pause JS sync timers; remote push delivery is separate |
| New content row published | Later topic/daily/detail reads | Catalog grows; no automatic content announcement |
| Mobile changes pushed to develop | Preview EAS Update workflow | Preview-channel OTA, subject to workflow paths |
| Release merge into main | Release workflow; separate Railway deploy | OTA and release tag; APK gate; backend deployment |
| New app version with highlights | In-app release-card hook | Show until dismissed for that device/version |
| Monday 00:00 UTC or main push | GitHub audit | Scan dependencies/code; may create deduplicated findings issues |

There is no automatic chain from "a user finishes a topic" to "a new topic is created" to "everyone gets an email." Each would need explicit product rules and implementation. Likewise, midnight makes a new date eligible, but does not by itself assign lessons to all accounts.

Sources: `backend/migrations/0001_schema.sql`; `backend/app/services/selection.py`; `backend/app/services/reminders.py`; `mobile/src/context/ProgressContext.tsx`; `.github/workflows/`.

# 26 | Offline storage: what survives no internet

<!-- diagram: offline_storage -->

The app retains more than a card title. It stores full downloaded lesson bodies, including examples, and tries to download any missing saved lessons after successful state loads. It uses three concurrent download workers and individual cache entries rather than one giant lesson blob.

| Data | Storage / behavior | Offline limit |
| --- | --- | --- |
| Auth session | Native SecureStore adapter; web AsyncStorage | Cached identity helps browsing; server requests still need valid authentication. |
| Daily/progress snapshot | AsyncStorage plus in-memory repository | Last known state may be stale. No fresh server assignment can be created offline. |
| Full concept bodies | Per-slug OfflineCache | Only completed downloads can be read offline. |
| Saved metadata | Account-keyed paged cache | Older titles can also be recovered from downloaded bodies. |
| Topics/follows | Shared cached topic store | Queued local choices override stale responses until replay. |
| Pending mutations | Durable serialized outbox | Survives restart while the account remains; not a cloud backup. |
| Reminder preferences | Last known settings cache | Toggle update needs the API; failure reverts the switch. |
| Theme / release dismissal | Device-scoped AsyncStorage | Persists independently of account progress. |

**A bookmark is not a completed download.** Saving a concept online can start a background body fetch; closing the app or losing connectivity before it finishes can leave an unavailable detail page offline. Opening a previously cached lesson is more reliable than assuming all saved bodies have downloaded.

Signed-in screens preserve useful caches and offer retry/empty states when data is missing. They do not substitute invented totals or demo lessons for real account data. Native connectivity is inferred from requests; there is no native network-status listener in this APK. The web build also listens for browser online/offline events.

Sign-out clears server state, legacy daily cache, downloaded lesson cache, saved metadata, topics/follows, notification preferences and the outbox. Epoch guards prevent late responses from repopulating cleared data. Theme and What's New dismissal remain device preferences. Clearing app storage or reinstalling removes local availability; server-confirmed progress can be fetched again after sign-in.

Sources: `mobile/src/services/conceptApi.ts`; `mobile/src/services/offlineCache.ts`; `mobile/src/services/accountCaches.ts`; `mobile/src/services/remoteProgressRepository.ts`; `mobile/src/services/savedApi.ts`.

# 27 | Offline actions and safe replay

<!-- diagram: sync -->

The outbox stores the user's latest intent for each like, save, topic set or completion date. A like followed by an unlike should replay the final desired state, rather than blindly replaying every tap. Disk writes are serialized, and dequeue checks avoid deleting a newer action with the same key.

The visible UI updates optimistically. Network writes and queue replay share a mutation chain. Fresh server responses are reconciled with pending intentions, so a still-queued save is not lost simply because the server snapshot has not seen it yet.

| Replay situation | What the code does |
| --- | --- |
| Like/save | PUT for desired on; DELETE for desired off |
| Topic changes | Replace the complete followed set |
| Completion from today | Attempt the server completion endpoint |
| Completion from an older device day | Drop it; do not repair historical streaks |
| Network failure | Retain outstanding work and retry later |
| Server 5xx | Keep that intention for a later attempt |
| Rejected 4xx | Drop that entry so an unreplayable action does not block forever |
| Sign-out/account change | Invalidate old work and clear its caches/queue |

When work remains or requests cannot reach the API, retries back off through 5, 10, 20 and 30 seconds, then stay bounded at 30 seconds. Partial success does not reset a failed cycle into a tight request loop. When reachable and the queue is empty, routine retry polling stops.

Foregrounding the app wakes the loop; browser reconnect can wake it immediately. Going into the background pauses its timers. There is no closed-app OS background sync worker. Restoring Wi-Fi while the native app is closed does not itself guarantee queued completion is uploaded before the next reminder.

**Tradeoff:** these rules preserve fast interaction and make common retries safe, but offline progress is provisional. The server's day and completion rules remain authoritative. A phone left offline across midnight can lose yesterday's queued learning credit even though downloaded lessons remain readable. Conflicting choices from two devices are not merged into a collaborative document; later accepted writes determine the stored state.

Sources: `mobile/src/services/mutationOutbox.ts`; `mobile/src/services/remoteProgressRepository.ts`; `mobile/src/services/syncLoop.ts`; `mobile/src/context/ProgressContext.tsx`; `mobile/src/services/pendingProgress.ts`.

# 28 | GitHub to production: the release path

<!-- diagram: release -->

The repository is `Coding-Moves/one-concept`. Team feature/fix branches use a descriptive `codex/` prefix by default and target `develop`. The owner's workflow preserves focused commits and reviews one coherent chunk per PR. A production release is a separate `develop` to `main` PR.

Before release, `mobile/app.config.js` supplies a new marketing version and a matching nonempty What's New entry. Pending database migrations are applied and verified separately, then recorded in `applied.txt`. The migration check must pass. Merging into `main` triggers production effects.

| Release component | What happens |
| --- | --- |
| Production OTA | EAS publishes the mobile update with the production environment. |
| Preview OTA | The same release updates preview devices too. |
| Version tag / GitHub Release | Created only after the OTA job succeeds; an already-used tag causes failure. |
| Release APK workflow | Explicitly dispatched because token-created release events alone are insufficient for this workflow chain. |
| APK native gate | Rebuilds only when the shipped native runtime differs from the one recorded for apk-latest. |
| Backend | Railway auto-deployment is documented as independently following main; it is not gated behind EAS success. |

`EXPO_TOKEN` authorizes EAS. GitHub's workflow token creates tags/releases and dispatches the APK job. The release workflow serializes releases so quick merges do not race the version tag. EAS public environment values are bundled during OTA publication; missing configuration can break an update even if the code is valid.

**Important deployment distinction:** GitHub merge, successful OTA publish, Railway deployment health and actual phone adoption are four different observations. A successful release job proves the workflow completed its steps; it does not prove every phone has launched and downloaded the update.

Current evidence: release PR #191 and migration PR #193 are merged. GitHub release v1.8.0 was published on 12 September 2026 at 19:29 UTC, which is 13 September at 00:29 in Karachi. The release and migration workflows succeeded. Live Railway rollout and generation-cap settings remain unverified in this handbook.

Sources: `RELEASING.md`; `.github/workflows/release.yml`; `.github/workflows/release-apk.yml`; `.github/workflows/eas-update.yml`; `mobile/eas.json`.

# 29 | OTA, native builds and the What's New card

<!-- diagram: ota -->

The app has a native layer installed in its APK and a compatible JavaScript/assets layer that EAS Update can replace. Its marketing version is **1.8.0** while `runtimeVersion` stays **1.3.0**. They answer different questions: "which release is this?" and "which native binary can run this update?"

| Change | Delivery decision |
| --- | --- |
| Lesson data in PostgreSQL | API data refresh; no software update needed |
| Compatible screen/state JavaScript | OTA on the intended channel |
| New native module/permission/config | New native build and runtime procedure |
| Backend endpoint implementation | Railway backend deployment; compatible API contract still matters |
| Email template | Supabase template installation; separate from APK/OTA |

The checked-in config checks for updates on load with a zero fallback wait. That favors quick startup using the cached/bundled code. It is not a promise that a freshly published update is applied instantly in the currently open session; download readiness, later launch and Expo's update behavior matter. Runtime matching is required for a compatible update. [Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/).

The stable GitHub `apk-latest` asset is the sideload installation path. A JavaScript-only release can ship without producing a new APK. EAS profiles distinguish development, preview, production and production-apk; the channel identifies which update stream a build follows.

**What's New:** a bundled entry matches the current app version. The hook checks the last dismissed version stored on the device. An authenticated user sees the card when a matching entry exists and that version differs from the last dismissed value. Got it persists dismissal; long highlight lists scroll within the card.

This is device-wide, not per account: signing out does not reset the dismissal. Reinstalling, clearing storage, or a failed storage write can make it appear again. The implementation stores the last dismissed version, not a permanent set of every version ever seen, so rolling between versions can also show cards again. No email, cron or push is needed to display it.

Sources: `mobile/app.config.js`; `mobile/eas.json`; `mobile/src/data/whatsNew.ts`; `mobile/src/hooks/useWhatsNew.ts`; `mobile/src/services/whatsNewStore.ts`.

# 30 | CI, dependency bots and validation

| Mechanism | Trigger | What it establishes |
| --- | --- | --- |
| Preview OTA | Qualifying mobile pushes to develop; manual dispatch | Publishes to selected EAS channel; not a full regression suite |
| Manual Android build | Explicit workflow dispatch | Starts an EAS build with selected profile |
| Release | Main push | Production/preview OTA, tag and release, APK workflow dispatch |
| Migration ledger check | Main push; PR into main; manual | Every SQL filename is listed as applied; no live DB inspection |
| Security & Code Audit | Monday 00:00 UTC; main push; manual | pip-audit, npm high/critical findings, Ruff F/E9 and TypeScript |
| Dependabot | Weekly for Python, npm and Actions | Opens dependency-update PRs; Expo-managed major/minor updates are restricted |
| Stale cleanup | Daily 01:00 UTC | Marks automated issues stale after 30 days, closes after 7 more; excludes PRs |

The audit creates deduplicated findings issues; it does not change code or automatically merge fixes. Tool failure is distinct from discovered vulnerabilities. The checked-in workflows do not include a general pull-request pytest job, so a green publish is not equivalent to all backend tests passing.

**Local validation tools:** mobile TypeScript uses `npm run typecheck`; Node 24 runs the built-in regression tests. Browser acceptance scripts exercise password UI, saved offline reading, replay races and release-card layout. Android/web exports check packaging but are not a physical-device run. The backend uses `.venv/bin/python -m pytest`, with disposable PostgreSQL 16 via Podman for integration tests and mocked provider calls.

The 1.8.0 preparation log records 145 backend tests and 33 Node tests passing without skips, plus TypeScript, exports and relevant browser scenarios. Those are historical results from release preparation, not tests rerun for this documentation task. Physical-phone behavior and actual inbox delivery were not established there.

GitHub currently shows the 1.8.0 release and migration check succeeded, but the Security & Code Audit run failed. That run must be investigated before calling the operational checks all green; this handbook does not equate the failure with a confirmed vulnerability. Documentation validation here consists of source/link checks and PDF text/render inspection.

Sources: `.github/workflows/`; `.github/dependabot.yml`; `mobile/tests/README.md`; `backend/tests/conftest.py`; `docs/WORK_LOG.md`.

# 31 | Performance, scale and cost drivers

The strongest cost decision is storing generated lessons once for everyone. If one lesson is read by 1,000 accounts, it needs one successful publication, plus any failed generation attempts, rather than 1,000 separate personalized model calls. Reading still costs API/database traffic, storage and delivery.

<!-- diagram: cost -->

| Area | Existing optimization | Practical limit |
| --- | --- | --- |
| Startup | Cached paint; compact state includes today's body | Membership arrays and some aggregate work still grow with account history. |
| Collections | Bounded enriched rows and cursor pages | Saved intentionally loads older metadata for full search; total local collection can grow. |
| Offline reading | Per-entry bodies; 3 download workers | Downloading a large collection still uses network and device storage. |
| Database | Pool of 5 with up to 5 overflow per process; pre-ping; LIFO reuse | Multiple API processes/workers multiply possible connections. |
| Idle connection latency | Default 30-second warm-up; 5-second probe budgets | Keeps a hot connection, not every possible burst connection; adds probe traffic. |
| Model calls | Shared catalog, bounded jobs and daily reservations | No factual-review gate or shared RPM limiter; failed attempts still spend reservations. |
| Reminders | Atomic claims and batches of 100 messages | More users/devices mean more fan-out; claim deduplication does not guarantee delivery. |

Connections recycle after 1,800 seconds. Transaction-pooler mode disables prepared-statement caching and avoids pinning a transaction across the Gemini request. The API lifecycle manages warm-up and cleanup; cron workers do not start the API warm-up task.

The work log's controlled 365-record fixture shrank startup state from 151,007 to 55,676 bytes, about 63%, using compact mode. This is one local fixture, not a production percentile or proof of a constant response size. Local connection warm-up experiments also showed benefits under induced idle expiry, not measured Railway/Supabase production latency.

**Cost model:** total operating cost is hosting + database/storage/traffic + Auth/email + build/update delivery + model calls. Model spending depends on attempted calls, input/output tokens, selected model and tier. The 200-call setting is neither a dollar budget nor a guarantee of 200 published lessons. No invoices, current paid tiers or real monthly usage were read for this report.

As traffic grows, measure API latency and failures, database connections, assignment exhaustion, remaining unassigned lessons per active reader/topic, queue delays, generation outcomes and push receipts before adding more infrastructure.

Sources: `backend/app/db/session.py`; `backend/app/db/keepalive.py`; `backend/app/services/state.py`; `mobile/src/services/conceptApi.ts`; `docs/WORK_LOG.md`.

# 32 | Architecture choices: advantages and tradeoffs

These comparisons are engineering judgments about this app's requirements, not claims that one vendor or language is universally best. The existing design is a reasonable fit for a small daily-learning product with shared content and account-specific progress.

| Current choice | Alternative design | Why the current approach fits / what it costs |
| --- | --- | --- |
| React Native + Expo | Separate native Android and iOS apps | Shares UI/product logic and release tooling; still requires native compatibility and device testing. |
| TypeScript client + Python API | One language on both ends | Strong frontend tooling plus readable backend services; contracts must stay aligned across languages. |
| Supabase Auth + custom FastAPI | Direct mobile application writes to hosted database APIs | Centralizes trusted-day, completion and budget rules; adds a hosted API to operate. |
| PostgreSQL relationships | Document-oriented personal lesson copies | Natural uniqueness, joins and transactional claims; complex SQL must be reviewed and indexed. |
| Shared generated catalog | Generate separately per learner/request | Amortizes model work and gives stable reading latency; less individual tailoring and finite catalog runway. |
| Curated titles + generated prose | Fully automatic topic invention | Controls syllabus and slug identity; curation and factual quality still need maintenance. |
| Topic rotation + random tie-break | Ordered prerequisite curriculum | Variety and simple personalization; no guaranteed beginner-to-advanced teaching sequence. |
| Server reminder schedule | Device-only local reminder schedule | Uses server-confirmed completion across devices; depends on worker health, network and push delivery. |
| Custom local outbox | Always-online interaction | Supports unreliable connections; introduces replay, date-boundary and account-cleanup complexity. |
| PostgreSQL job claims + process prefetch | Dedicated durable task queue | Fewer moving parts; API prefetch can stop when its process dies and lacks queue-level delivery guarantees. |
| EAS OTA with pinned runtime | New binary for every screen edit | Faster compatible updates; incorrect runtime discipline can break installed apps. |

**What I would keep:** a shared catalog, verified JWT identity, database uniqueness rules, server-owned dates, durable offline intentions, and a separate production release branch. They directly support the product's core promises.

**What deserves the next engineering investment:** reliable content runway, visible delivery outcomes, automated regression gates and clear operational configuration. Adding microservices or a new frontend framework would not by itself fix catalog exhaustion or missed reminders.

Sources: `mobile/package.json`; `backend/app/services/selection.py`; `backend/app/services/pool.py`; `backend/app/services/reminders.py`; `RELEASING.md`.

# 33 | Current limits and sensible next priorities

This is a source-based assessment, not a claim that these improvements have already been built. No implementation changes were made while producing the handbook.

| Priority | Finding | Next useful step |
| --- | --- | --- |
| 1 | Shared count targets can stop growth for a reader who has used all 25 concepts | Define required personal runway and change replenishment policy with concurrent-user/exhaustion tests. |
| 2 | Catalog-exhausted accounts can still receive the generic lesson reminder | Decide the intended exhausted-state reminder policy; make eligibility/copy reflect available learning. |
| 3 | Reminder claims survive failed delivery; no receipt polling | Add delivery visibility and an explicit retry/idempotency design if reliable reminders are a product promise. |
| 4 | Email transport/inbox success remains unverified | Verify configured SMTP, non-team delivery and complete signup/recovery/password-change flows. |
| 5 | No general PR regression suite in workflow YAML | Gate important branches with the existing backend and mobile tests, including real disposable PostgreSQL. |
| 6 | Daily budget is shared, per-minute pacing is not | Coordinate provider throughput if multiple processes start generating together. |
| 7 | Offline completion can expire across midnight | Choose and document a deliberate product policy before altering trusted-date semantics. |
| 8 | Generated prose passes format checks, not factual review | Add editorial sampling or a reviewed publication state if teaching accuracy requires it. |

Other boundaries worth understanding: visible History contains the last ten records; full history endpoints exist but the screen does not expose full paging. New topics are not automatically followed by existing users. Custom reminder times are supported by the API but not editable in the current Profile UI. Background synchronization works while active/reopened, not as a closed-app OS task.

The project currently does not implement a learning digest email, adaptive quizzes, spaced repetition, a prerequisite graph, a content CMS, payments, or a dedicated analytics/crash-reporting SDK. These would be new features. A future weekly digest would need learning aggregation, user preference/unsubscribe behavior, a scheduler, a delivery provider/template and deduplication records; Auth security emails are a different subsystem.

Supabase's current documentation recommends publishable/secret keys over legacy anon/service-role names. This repository still uses the legacy naming contract. Treat key migration as planned configuration/compatibility work, not a reason to put secrets in mobile code. [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

Sources: `backend/app/services/prefetch.py`; `backend/app/services/reminders.py`; `mobile/src/screens/HistoryScreen.tsx`; `mobile/src/screens/ProfileScreen.tsx`; `.github/workflows/`.

# 34 | Practical operating and troubleshooting guide

Start with the layer that owns the symptom. A frontend retry cannot repair a missing database table; an app release cannot install an email template; a new Gemini key cannot bypass the generator's shared-count stop rule.

| Symptom | Inspect first | What separates the likely causes |
| --- | --- | --- |
| Today unavailable on one phone | Connectivity, session and state response | Cached body missing versus API failure versus real daily:null exhaustion |
| Same lesson keeps showing today | Assignment date and ID | Normal daily pinning; completion does not unlock a second lesson |
| All followed lessons exhausted | Per-user assigned set and global candidates | Other users may still have plenty of eligible content |
| No new lessons generated | Enabled/key/model, shared target, backlog, daily cap, worker logs | A full global shelf stops refill even if a reader has zero remaining |
| Backlog stuck generating | claimed_at and scheduled-worker execution | Top-up reclaims rows older than 30 minutes; verify the worker actually runs |
| Reminder missing | Permission/channel, stored token, enabled prefs, timezone, completion, claim log | Claimed is not delivered; a failed send can leave a used slot |
| Reminder after learning | Is completion on server or only offline? | Also check a claim/send race and the current assigned_for date |
| Email never arrives | Supabase Auth logs and actual SMTP configuration | Default sender restrictions, provider failure, spam handling or invalid recipient |
| Reset page unavailable | Backend public anon key and redirect URL | App and email can work while the recovery page is misconfigured |
| Update absent on phone | Channel, runtime, EAS publish and relaunch | Marketing version alone does not establish native compatibility |
| Backend query fails after release | Migration application and deployed revision | Ledger consistency alone is not proof of schema or healthy rollout |
| Saved title opens to no offline body | Whether body download completed | Saved metadata and downloaded content are separate |

**Useful local commands:** from `mobile/`, `npm ci`, `npm run typecheck`, and `npm test` with Node 24. From `backend/`, use `.venv/bin/python -m pytest` with test configuration. Development uses `python -m uvicorn app.main:app --reload --port 8000`. A physical phone needs a reachable LAN backend address, not its own `localhost`.

**Operational worker commands:** `python -m app.workers.reminders` sends real messages under real configuration; `python -m app.workers.pool_topup` can spend Gemini quota and publish content; `rewrite_catalog` can change existing prose. They are actions, not harmless health checks. Use controlled test configuration for exploration. This report did not execute them against production.

Read logs and aggregate counts without printing connection strings, bearer tokens, recovery URLs or provider credentials. Observe delivery and content availability separately from process liveness.

Sources: `backend/README.md`; `mobile/tests/README.md`; `backend/app/workers/`; `backend/app/config.py`; `mobile/.env.example`.

# 35 | Your seven-day learning digest

Use this as a one-week self-study plan. It is part of the PDF, not an automation or an email subscription. Spend roughly 30-45 minutes a day: read, redraw one flow from memory, and explain it aloud as if onboarding another engineer.

| Day | Read these chapters | One concrete outcome |
| --- | --- | --- |
| 1 - Product and stack | 01-06 | Draw the phone/Auth/API/database map. Explain topic, concept, assignment and learned without mixing them. |
| 2 - Identity and email | 07-10 | Trace signup and password reset. Identify which values are public configuration and which are sensitive credentials. |
| 3 - API and database | 11-17 | Trace a daily assignment and a completion through routes, SQL and uniqueness constraints. Explain why two devices agree. |
| 4 - Catalog and AI | 18-21 | Reproduce the 25-concept example on paper. Explain why unread=0 does not mean published=0. |
| 5 - Notifications | 22-25 | Draw registration and delivery separately. Walk through the three reminder times and an offline completion. |
| 6 - Offline and release | 26-30 | Trace an offline save through restart/replay, then a change from develop to compatible production OTA. |
| 7 - Engineering judgment | 31-47 | Explain current limits, then trace issue #195's future design and answer the before/after scenarios. Allow extra study time for this final day. |

**Weekly recap to keep:** the mobile app is the presentation and cache; Supabase Auth establishes identity; FastAPI owns application rules; PostgreSQL owns durable records and concurrency constraints; Gemini writes shared content; Python workers decide refills/reminders; Expo and platform push services deliver notifications; GitHub/EAS/Railway deliver software.

The three questions you should be able to answer confidently are: **Who owns this fact? What event changes it? What happens if the operation runs twice or fails halfway?** Those questions explain assignments, bookmarks, notifications, migrations and budget reservations with the same engineering discipline.

For hands-on study, use a disposable database and dummy provider responses. Simulate two users with different follows, a same-day second device, an exhausted catalog, a late completion and a failed push. The goal is to understand observable behavior, not spend quota or send test messages to actual learners.

Sources: `docs/CODEBASE_MAP.md`; `backend/tests/test_selection.py`; `backend/tests/test_reminders.py`; `mobile/tests/README.md`.

# 36 | Check your understanding: scenarios and answers

| Scenario | Answer you should be able to explain |
| --- | --- |
| Ali and Sara both follow AI. Must Monday match? | No. Each has a separate candidate set and assignment. The same concept is allowed across users. |
| Ali opens Monday's lesson but skips learned. Can it return Tuesday? | No. Selection excludes prior assignments, not only completions. |
| Ali changes follows after loading today's card. What changes now? | Follow state changes; today's assignment remains. The next unassigned date uses the updated set. |
| A topic holds 25 published concepts and Ali has received all of them. Is the shared count zero? | No, still 25. His remaining eligible count is zero, which exposes the current refill mismatch. |
| Gemini is disabled but the shared catalog has unseen lessons. Does Today work? | Yes. Daily reading selects stored published rows. |
| Cap is 200 and two workers have each used 100 calls. Does a restart grant another 200? | No. The shared daily database ledger persists across workers/restarts. |
| A rate-limited attempt is refunded in backlog. Is its daily quota refunded too? | No. The committed reservation remains; backlog retry accounting is a different counter. |
| Learned is queued offline before 14:00. Is the afternoon reminder suppressed? | Only if server completion has arrived before the worker's relevant decision; local UI alone is insufficient. |
| Reminder log row exists but the Expo HTTP request failed. Will the next pass resend it? | Not in the current implementation; the slot is already claimed. |
| A saved title is visible offline. Must its example be available? | No. The full body must have finished downloading. |
| Version rises to 1.8.1 with only compatible JS changes. Must runtime rise? | No. Runtime changes only with the native release procedure. |
| A new topic row is inserted. Do existing accounts follow it automatically? | No. Default follows are established at account bootstrap, not retroactively. |
| A GitHub release exists. Did Supabase email HTML update too? | No. Templates are installed separately. |
| Does a green migration filename check prove the production table exists? | No. Actual application and verification must precede the ledger entry. |

**Advanced design exercise:** propose a refill policy that keeps at least seven unassigned concepts for engaged readers in each followed topic, without generating seven new copies per person. Define the active-user window, bounded job size, shared budget, concurrent-worker behavior, sparse/new-topic policy and the exhausted-user experience. This is a proposed design exercise; seven is not a current app setting.

**Acceptance mindset:** write down an observable outcome before coding. For example, under the proposed policy, a reader near exhaustion should gain future eligible content even when the topic already has 25 shared concepts, while a second reader continues seeing the same shared catalog.

Sources: `backend/app/services/selection.py`; `backend/app/services/prefetch.py`; `backend/app/services/generation_budget.py`; `backend/app/services/reminders.py`.

# 37 | Glossary: beginner words to advanced concepts

| Term | Plain explanation in this app |
| --- | --- |
| Frontend / backend | What runs on the user's device / the trusted service behind it. |
| API / endpoint | A network contract / a specific path and method implementing it. |
| JSON | Structured text used for request and response data. |
| JWT / bearer token | Signed identity claims / a credential sent with an API request. |
| JWKS / ES256 | Public verification-key set / the selected signature algorithm. |
| Authentication / authorization | Prove who the caller is / decide which records or actions they may access. |
| PostgreSQL / SQL | The relational database / the language used to query and change it. |
| UUID / slug | A unique database identifier / a readable stable identifier used in routes. |
| Foreign key | A database relationship that points to an existing row. |
| Unique constraint | A rule the database enforces even when requests race. |
| RLS | Row Level Security: database policies limiting client-visible records. |
| Transaction / commit | A group of related changes / making those changes durable together. |
| Idempotency | Repeating an action keeps the intended state, such as saved remaining saved. |
| Race condition | Concurrent operations whose timing can change the result without protection. |
| SKIP LOCKED | Let one worker skip another worker's claimed row instead of duplicating that task. |
| Cache / stale | A local copy / a copy that may no longer match the server. |
| Optimistic UI | Show the intended change before the server confirms it. |
| Outbox / replay | Persisted pending actions / retrying them later. |
| Epoch guard | A generation marker rejecting a callback from an old account/cache lifecycle. |
| Backoff | Wait longer between repeated failures instead of hammering the service. |
| Cron / worker | A timed launch rule / a process that performs background work. |
| Push token / push receipt | Device delivery address / downstream delivery feedback. |
| SMTP | Email transport used by the configured account-email sender. |
| Migration | An ordered database change with an immutable history after application. |
| CI / CD | Automated checks / automated delivery or deployment steps. |
| OTA / APK | Downloaded compatible app update / Android installation binary. |
| Runtime version / channel | Native compatibility identifier / chosen update stream. |
| Watermark / runway | Threshold prompting work / how much eligible content remains for a reader. |

**Three different "tokens":** a Gemini output token is a unit of model text processing; an access token is an account credential; a push token is a delivery address. They are unrelated and should never be substituted for one another.

Sources: `docs/CODEBASE_MAP.md`; `backend/app/core/security.py`; `backend/app/services/pool.py`; `mobile/src/services/mutationOutbox.ts`.

# 38 | Code atlas: where to look when you forget

All repository source links in this handbook are pinned to the inspected base revision `3cc5af3382ba8e735be573d0ccb7f79ef6af9181`. This avoids a future branch edit silently changing the evidence behind an explanation. Paths are relative to the repository root.

| If you want to understand... | Start here |
| --- | --- |
| Screen composition and providers | `mobile/App.tsx` |
| UI appearance | `mobile/src/theme/index.ts`, `mobile/src/components/` |
| Auth, sign-in, signup, sign-out | `mobile/src/context/AuthContext.tsx` |
| Session recovery and secure storage | `mobile/src/services/authSession.ts`, `mobile/src/lib/secureStorage.ts` |
| API headers, timeout and connectivity | `mobile/src/api/client.ts`, `mobile/src/api/fetchWithTimeout.ts` |
| Shared screen state | `mobile/src/context/ProgressContext.tsx` |
| Server cache and action replay | `mobile/src/services/remoteProgressRepository.ts` |
| Full offline reading | `mobile/src/services/conceptApi.ts`, `mobile/src/services/offlineCache.ts` |
| Saved paging and topic choices | `mobile/src/hooks/useSavedConcepts.ts`, `mobile/src/services/topicStore.ts` |
| Navigation to backend routes | `backend/app/api/v1/router.py` and adjacent route files |
| Daily lesson algorithm | `backend/app/services/selection.py` |
| Learned state and streaks | `backend/app/services/interactions.py`, `backend/app/services/streaks.py` |
| Catalog writing and concurrency | `backend/app/services/generation.py`, `backend/app/services/pool.py` |
| Refill thresholds and shared budget | `backend/app/services/prefetch.py`, `backend/app/services/generation_budget.py` |
| Reminder selection and delivery | `backend/app/services/reminders.py`, `mobile/src/services/notifications.ts` |
| Schema, constraints and SQL triggers | `backend/migrations/` |
| Public account pages and email HTML | `backend/app/api/v1/pages.py`, `backend/email-templates/` |
| Production release behavior | `RELEASING.md`, `.github/workflows/release.yml` |
| Native runtime and build profiles | `mobile/app.config.js`, `mobile/eas.json` |
| Recorded tests and operating decisions | `docs/WORK_LOG.md`, `mobile/tests/README.md`, `backend/tests/` |

Older comments and documents sometimes describe a local-only client, synchronous on-demand generation or one query for the whole startup response. Current execution paths take precedence: authenticated mobile state is remote, generation is off the daily response path, and folded daily selection uses extra database queries.

Sources: `docs/CODEBASE_MAP.md`; `docs/WORK_LOG.md`.

# 39 | Evidence, references and what was verified

**Snapshot date: 13 September 2026, Asia/Karachi.** The handbook describes the source tree at develop `3cc5af3`, whose tree matched the released application inspected here. Production main was `2e537f6`. Configuration defaults are labeled as defaults; secrets and real user records were not read into the report.

| Evidence level | Established for this report |
| --- | --- |
| Source inspected | Mobile stack/screens/state, Auth, API, SQL, selection, generation, reminders, caches and release workflows |
| GitHub checked live | #191 and #193 merged; v1.8.0 exists; release/migration/APK workflow success; audit workflow failure; #187 open draft |
| Historical record | 1.8.0 tests, migration 0010 production verification, owner-reported template installation |
| Issue #195 checked live | Open future plan; its dated 125-lesson inventory is attributed to the issue in chapter 40, not independently re-queried here |
| Not verified live | Railway deployment/cron settings, current catalog counts, model/key overrides, provider limits for this account, SMTP delivery, push credentials/receipts, phone adoption |
| Not executed | Production SQL, real Gemini generation, real reminders/emails, mobile/backend regression suites for this documentation-only task |

**GitHub evidence:** [release PR #191](https://github.com/Coding-Moves/one-concept/pull/191), [migration PR #193](https://github.com/Coding-Moves/one-concept/pull/193), [v1.8.0 release](https://github.com/Coding-Moves/one-concept/releases/tag/v1.8.0), [release workflow](https://github.com/Coding-Moves/one-concept/actions/runs/34714212293), [migration check](https://github.com/Coding-Moves/one-concept/actions/runs/34714212291), [APK workflow](https://github.com/Coding-Moves/one-concept/actions/runs/34714318696), [failed audit](https://github.com/Coding-Moves/one-concept/actions/runs/34714212289), [deferred email setup #187](https://github.com/Coding-Moves/one-concept/pull/187). A successful APK workflow can mean its runtime gate skipped rebuilding.

Provider documentation checked on the snapshot date supports the platform behavior, while repository source determines how this app uses it:

- [Expo push overview](https://docs.expo.dev/push-notifications/overview/): Expo routes notifications through FCM/APNs.
- [Expo runtime versions](https://docs.expo.dev/eas-update/runtime-versions/): native/update compatibility and runtime discipline.
- [Supabase SMTP](https://supabase.com/docs/guides/auth/auth-smtp): default-sender restrictions and custom transport.
- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): public component keys versus elevated server keys and user identity.
- [Gemini rate limits](https://ai.google.dev/gemini-api/docs/rate-limits): project/model limits and midnight Pacific daily reset.
- [Railway cron jobs](https://docs.railway.com/cron-jobs): externally configured UTC schedules, exit requirements and timing limits.

Diagrams are explanatory models drawn from these flows, not screenshots or measurements of live infrastructure. User names, week schedules and numeric runway exercises are examples. Recommendations are separated from implemented behavior. The most important finding is the distinction between shared published stock and each learner's unassigned stock.

Sources: `docs/WORK_LOG.md`; `docs/CODEBASE_MAP.md`; `mobile/app.config.js`; `backend/app/config.py`.

# 40 | Issue #195: sustainable learning beyond exhaustion

**Status: proposed future design, open issue, not implemented by this handbook.** Issue #195 is titled "[P1] Sustain daily learning with continuous replenishment, curriculum growth, and review." It addresses the finite-catalog failure as a content lifecycle problem, rather than increasing 25 to another fixed ceiling.

The issue reports a read-only production inventory dated 13 September 2026. This table reproduces that issue's reported snapshot; this PDF task did not independently query production. It does not prove the current worker schedule or generation switches are enabled.

| Subject | Published | Pending titles | Failed items |
| --- | --- | --- | --- |
| Artificial Intelligence | 25 | 5 | 4 |
| Computer Science | 25 | 3 | 6 |
| Linux & Systems | 25 | 3 | 6 |
| Mathematics | 25 | 5 | 4 |
| Software Engineering | 25 | 3 | 6 |
| Total | 125 | 19 | 26 |

The 150-title original queue consists of 105 generated entries, 19 pending and 26 failed entries. Together with the 20 initial seeded lessons, that explains 125 published lessons. Pending and failed rows are not ready-to-read stock. The supply is finite even if every remaining title could eventually be published.

<!-- diagram: future_lifecycle -->

The five work areas are: ongoing replenishment based on reader availability; an expandable reviewed curriculum; useful review/exploration when fresh content is unavailable; preservation of the shared library and bounded costs; and protected operational reporting with actionable alerts.

**Benefit for learners:** a temporary writing or provider outage need not turn Today into a dead end. **Benefit for the owner:** content demand, queue health and publishing become visible and manageable. **Benefit for engineering:** the proposal preserves JWT identity, backend writes, no repeated new assignments and shared budgets, while introducing explicit records for the new behaviors.

The issue requests eventual implementation in one cohesive PR into develop with focused commits and regression coverage. This handbook only explains that design; its documentation PR is not the implementation PR for #195.

Future-design source: [Issue #195](https://github.com/Coding-Moves/one-concept/issues/195), read 13 September 2026; no comments were present.

# 41 | Future replenishment: reserve, demand and cadence

**The proposed change:** keep the initial published-catalog target separate from ongoing reader supply. Use the daily selector's eligibility rule when measuring unseen content: previously assigned concepts do not count as new, even when they were skipped.

<!-- diagram: runway -->

The issue suggests considering a **60-90-day reserve per subject for experienced active readers**. This is a starting proposal, not a configured guarantee. The implementation must choose an affordable target, an active-reader definition, consumption assumptions, and the warning threshold before enabling generation.

| Measure | Illustrative meaning, not a chosen production setting |
| --- | --- |
| Remaining eligible stock | 12 approved concepts never assigned to an experienced reader in a subject |
| Consumption assumption | 1 new concept from that subject per day for a subject-only daily reader |
| Estimated reserve | 12 / 1 = 12 days; a reader with several follows consumes each subject differently |
| Reserve target | A chosen goal such as 60 days; the issue also suggests considering 90 |
| Refill gap | At 1/day, growing 12 to 60 requires 48 additional eligible approved concepts |
| Sustainable cadence | Ongoing approved publication must match or exceed relevant consumption, or the reserve shrinks |

If consumption is one/day and approved publication is one/day, the reserve stays roughly level; it does not build a depleted reserve back to 60. If publication is two/day during recovery, net growth is one/day before failed drafts and other constraints. These are simple planning examples, not projected real throughput. With no approved output, a 60-day reserve buys about 60 such consumption days, not unlimited new content.

**Durable coalescing:** store one bounded subject refill goal/work request, or use an equivalent durable scheduled mechanism. Ten users and three API processes reporting low supply should update the same bounded objective, rather than add thirteen new batches or repeatedly raise the target. Workers claim work safely and consume the existing shared budget.

**Avoid misleading averages:** new accounts may have 125 unseen concepts while long-time readers have zero. An average across all users hides that failure. The final design needs a definition of experienced active readers and an explicit aggregation rule, such as a selected low-availability cohort or percentile. Those are design options, not decisions already made in #195.

Daily API reads continue returning stored content quickly. Supply aggregation belongs in bounded background work, not a scan of every user's history on every phone open.

Future-design source: [Issue #195, work areas 1 and 4](https://github.com/Coding-Moves/one-concept/issues/195).

# 42 | Future curriculum: plan, draft, review, publish

The proposal replaces a finite list of titles with a repeatable curriculum-maintenance process. Each subject can contain foundations, intermediate concepts and advanced applications, with learning objectives, stable identities, difficulty and prerequisites where useful.

<!-- diagram: editorial -->

| Stage | What an operator does | What becomes learner-visible |
| --- | --- | --- |
| Plan/import titles | Extend subject coverage in reviewed batches; check exact and likely semantic duplicates | Nothing yet; a title is not a lesson |
| Draft | Use AI assistance or editorial writing with references and version information | Draft stays separate from published material |
| Review | Check explanation/example accuracy, usefulness, objective and overlap | Only approved content becomes eligible |
| Publish | Release an approved version into the shared catalog | Eligible users can receive it on later selections |
| Correct | Review a revision while existing content remains available | Stable references survive; approved correction can replace the current reading version |

Different titles can describe the same idea. Unique slugs catch exact identifiers but do not establish semantic novelty. The proposed workflow should flag likely overlaps for review instead of counting a reworded duplicate as another day of meaningful new learning.

**Handling the 26 failed items:** group failures by cause, inspect the relevant records and fix the cause before retrying. A stale claim, duplicate slug, provider failure and invalid text need different responses. Preserve attempts and budget rules; blindly resetting every failed row would risk repeated spending without improving quality.

**Stable identities and versions:** keep existing concept IDs/slugs, saved references and assignment history. A corrected explanation should not create a fake "new concept" just to gain another catalog count. Explicit content versions make it possible to reason about cached older text, editorial history and what a learner reviewed. The exact version schema and cache invalidation policy remain implementation decisions.

The issue asks for a responsible operator and recurring content maintenance. Sustainable generation also requires sustainable title planning and review capacity. Producing hundreds of unreviewed drafts does not satisfy a reserve of approved lessons.

Prerequisites in curriculum metadata do not automatically create an ordered or adaptive daily selector. The implementation must define how, if at all, prerequisites affect eligibility and existing users. The issue establishes structured curriculum goals; it does not specify a complete adaptive teaching algorithm.

Future-design source: [Issue #195, work area 2](https://github.com/Coding-Moves/one-concept/issues/195).

# 43 | Future daily practice and honest progress metrics

When a fresh lesson is unavailable, Today should offer **Review a previous lesson** and **Explore another subject** when those options exist. Reviews should draw from previously completed lessons, favor ideas not reviewed recently, and clearly identify the activity as review.

<!-- diagram: review_schema -->

| Metric or record | Today | Proposed #195 behavior |
| --- | --- | --- |
| New assignment | One new concept per user/date; never repeat a concept for that user | Preserve these constraints |
| Review activity | No distinct durable review model | Add a separate persistent activity/review record |
| Unique concepts learned | Completed new assignments | Review does not increase this count |
| Review total | Not tracked separately | Count completed review activities separately |
| Daily learning streak | Consecutive completed assignment dates | A completed new lesson or qualifying review can satisfy the day's activity |
| Mere card open | Not learned | Still not a completed activity |

**Example:** Ali has 125 unique concepts learned and a 10-day streak. On day 11 there is no fresh eligible lesson, so he completes a labeled review. The intended result is 125 unique concepts, one additional completed review, and an 11-day activity streak. Sara receives a fresh lesson and completes it; her unique count rises by one. Their activities differ, but both practiced that day.

A useful conceptual model is a separate activity ledger referencing the user, concept, activity kind, assigned local date and completion state. That is an explanatory model, not a final table or API contract. Exact SQL/API design is not fixed in the issue. The important guarantees are durable identity, stable daily activity, idempotent completion and no duplicate new-concept assignment.

Changing streak semantics requires explicit documentation and compatibility handling. Preserve past assignments and completed days. For the new metric, completed new/review activities can contribute a distinct set of local dates; two completions on the same date must not earn two streak days. Show the difference between unique knowledge coverage and repeated practice.

If a user has no completed history, there may be nothing eligible to review. The app must show an honest unavailable state and retry/exploration options rather than invent content or promise a new lesson at an unverified time. The no-repeat promise still applies to **new assignments**, while repeats are intentional and labeled in review.

Future-design source: [Issue #195, work area 3](https://github.com/Coding-Moves/one-concept/issues/195).

# 44 | Future review flow: two devices, offline and rollout

<!-- diagram: review_flow -->

The intended review experience should retain the app's current responsiveness without weakening server authority. A completed review needs one logical identity that can survive retries, two-device access and offline replay. A client timestamp must not become permission to backdate arbitrary learning.

| Scenario | Proposed required behavior |
| --- | --- |
| Two devices open the same day's activity | Both resolve a stable activity; no competing daily choices that overwrite one another. |
| A completion is tapped twice | One logical completion and one day's streak credit. |
| A cached review is completed offline | Persist account-scoped intent and reconcile safely when allowed by the defined day/grace rules. |
| New content appears during review | Keep the activity in progress stable; do not swap cards or count the day twice. |
| Sign-out occurs during replay | Clear account data and reject late old-account callbacks. |
| Reviewed lesson is corrected | Preserve concept references and apply an explicit content-version/cache policy. |
| Neither fresh content nor a cached review body exists | Honest unavailable/retry state; no invented lesson body. |

**Decisions still needed:** whether offline review eligibility/activity identity is prepared during an earlier online session; exactly how review day/grace rules map to the current completion behavior; whether one active activity is allowed per user/day or more activities share one daily credit; how delayed completions are reconciled. Issue #195 demands consistent, idempotent behavior but does not settle every protocol detail.

A practical rollout sequence would be: add new immutable migrations and backward-compatible backend support; preserve legacy assignments and metrics; release the new client/cache/outbox behavior; verify controlled scenarios; enable the new replenishment/review policy gradually with measured limits. This sequence is an engineering recommendation, not a deployment performed here.

Old APKs and offline queues must retain valid semantics during the transition. Existing `POST /daily/complete` behavior cannot silently start completing unrelated reviews for legacy clients. New activity contracts should make the target clear. Native changes, if implementation introduces them, require the native release procedure; a review feature does not automatically mean a new APK is required.

The issue requires at least a year of simulated multi-user activity with outages, replenished planning queues, different follows and bounded generation. That long simulation checks whether the design stays useful beyond the original catalog, not just whether day 126 happens to pass.

Future-design source: [Issue #195, work area 3 and implementation plan](https://github.com/Coding-Moves/one-concept/issues/195).

# 45 | Future content operations: visible and bounded

Sustainability needs both product behavior and an operating process. Issue #195 asks for a minimal protected operator report/view, a responsible maintainer and a runbook. It does not require a separate large analytics platform; broader crash/metrics work remains linked to #161.

<!-- diagram: content_ops -->

| Signal | What it helps the owner decide |
| --- | --- |
| Published/approved supply and reader availability | Whether content exists but engaged readers have exhausted it |
| Estimated reserve days and low watermark | Whether planned publication can keep pace with consumption |
| Planned/pending/failed/stale work | Whether the bottleneck is ideas, writing, validation or a stopped worker |
| Last successful generation and publication | Whether drafts are being produced but no approved content is reaching users |
| Daily reserved calls, retry/limit state | Whether provider spending or quota is stopping progress |
| Generation enabled and schedule health | Whether the system is deliberately paused or unexpectedly inactive |

Alerts should identify actionable conditions, deduplicate repeated failures and report recovery. A routine healthy pass should not repeatedly notify the operator. This is proposed **operator alerting**, separate from current learner reminders and Supabase account emails. The issue does not select an alert transport/provider or authorize sending new messages today.

The runbook should cover title import, review/publication, correction, failure inspection, schedule/config verification, pausing generation and restoration from a tested backup. Reports must be restricted to authorized maintainers and avoid exposed credentials, sensitive raw errors and user-identifying details.

**Cost tradeoff:** reviews let the product stay useful without forcing a paid model call whenever a learner opens Today. New approved lessons still serve every eligible reader. A reserve and extra editorial stages increase storage, operator effort and planned generation. The shared Pacific-day ledger remains in place; a 60-90-day goal does not override an affordable daily cap.

**How I would judge success:** experienced readers have a monitored supply buffer; supply failures produce clear operational causes; outages allow eligible review practice; unique learning counts remain honest; repeated opens/workers cannot grow jobs without bound. A permanently empty title queue plus an ever-growing counter is not sustainability. Neither is a large pile of unreviewed drafts.

Future-design source: [Issue #195, work areas 4 and 5](https://github.com/Coding-Moves/one-concept/issues/195).

# 46 | Before and after: the design comparison

The right-hand column describes the intended outcome of issue #195 after a complete, validated implementation. It is not the current app and should not be presented to learners as an already-shipped promise.

| Concern | Before: current source | After: intended #195 design |
| --- | --- | --- |
| Meaning of 25 | Shared target can stop refilling | Initial catalog size separated from continuing reserve/cadence |
| Content supply signal | Global stock plus a personal trigger with a global stop gate | Experienced active readers' eligible supply, measured in background |
| Many users run low | Process-local prefetch deduplication | Durable coalesced per-subject work with a bounded persistent goal |
| Planned curriculum | Finite seeded titles | Repeatable reviewed import/extension workflow |
| AI quality | Format/style checks then publication | Draft separated from approved publication, with factual/usefulness review |
| Same idea, different title | Unique slugs alone do not detect semantic overlap | Likely duplicates surfaced for review |
| Fresh catalog exhausted | Global fallback, then no daily activity | Honest review/explore choices when available |
| Repetition | Cannot create a repeat new assignment | Preserve that rule; intentional labeled reviews use separate records |
| Streak during content gap | No assignment completion can break the run | A completed eligible review can provide daily activity credit |
| Unique learned total | New completions | Still unique new completions; review total shown separately |
| Content corrections | Shared body can change on refresh | Stable concept identity plus explicit review/version history |
| Offline review | No distinct review workflow | Cached bodies and account-scoped idempotent review replay |
| Model outage | Existing unseen content works until exhausted | Stored fresh content or eligible review; no synchronous model wait |
| Owner visibility | Logs and existing counters | Protected supply/queue/budget/worker report and actionable alerts |
| Spending control | Existing shared cap, switches and claims | Preserve them; reserve goals cannot create unbounded calls |

**Decisions to document before enabling the future system:** the active/experienced-reader definition; reserve target and publication assumptions; semantic-duplicate review process; approval ownership; activity identity and timezone/grace contract; metric names; compatibility and cache-version policy; alert transport and thresholds; rollout/backup/disable procedure.

**Benefit with a limit:** the proposal makes learning more resilient and content maintenance more deliberate. It cannot guarantee an endless stream of accurate fresh lessons with no editorial labor, no provider budget and no planned curriculum. Reviews are a useful fallback and learning activity, not evidence that new supply is healthy.

Future-design source: [Issue #195](https://github.com/Coding-Moves/one-concept/issues/195); interpretations and rollout suggestions in chapters 41-45 are explicitly labeled.

# 47 | Final Q&A: before and after issue #195

| Question | Before: what happens now? | After: what #195 intends |
| --- | --- | --- |
| I finish all 25 AI lessons. What is tomorrow? | Other eligible followed/global content, or exhaustion. Refill can stop because shared stock is already 25. | Reader availability can drive bounded refill; if fresh content is not ready, offer eligible review/exploration. |
| Do Ali and Sara still get different lessons? | They can; their follows and histories produce separate assignments. | Yes, progress stays personal and content stays shared. Review and new activities may also differ. |
| Do we generate a new lesson separately for each person? | No, content is shared. | Still no. Grow the curriculum once and reuse each approved concept across eligible readers. |
| What if everyone runs low together? | Several processes can trigger work; database claims protect backlog rows and budget. | Coalesce demand into durable bounded subject goals as well as preserving claim/budget protection. |
| Can the app repeat something I learned? | Not as another new daily assignment. Saved reading is manual revisiting. | Yes as an explicit review activity, using a separate record. New-assignment no-repeat stays intact. |
| Does a review turn 125 learned into 126? | There is no separate review completion. | No. Unique learned stays 125; the review total changes and the day can count toward activity streak. |
| Will my streak survive a Gemini outage? | Only while a new eligible assignment can be completed; exhaustion has no practice completion. | A qualifying completed review can preserve activity continuity. No review history/body may still mean unavailable. |
| Can I just open a review and get credit? | Opening is not a completed learned action. | Still no. Explicit completion is required. |
| What if a new lesson appears during review? | No separate review session exists. | Keep the active review stable. Use fresh content on a later eligible selection without double credit. |
| Can I review offline on two devices? | Existing offline queue handles current likes/saves/follows and same-day learned actions. | The new review protocol must support durable identity, safe replay and one logical completion under defined date rules. |
| Does 90 days of reserve mean infinite lessons? | No reserve-day policy exists. | No. It is a proposed buffer that shrinks if approved publication falls behind consumption. |
| Will this add a weekly learning email? | No learning-email digest exists. | #195 does not request that feature. Its operational alerts and review practice are different. |
| Will finishing a review stop reminders? | Current reminders check completed assignments only. | Reminder eligibility must be explicitly integrated with qualifying activity completion if it should stop after review; the exact contract must be decided and tested. |
| Is this future design built already? | No; issue #195 is open. | Only a complete implementation, migration/compatibility rollout and acceptance evidence can make these outcomes real. |

**What to remember:** today the app protects a daily new-concept assignment. Issue #195 would preserve that guarantee while adding sustainable supply management and a separate daily practice path. The final reminder answer identifies an integration decision needed to keep the new streak/activity meaning consistent across the product; it is not a feature already specified in detail or implemented.

Future-design source: [Issue #195](https://github.com/Coding-Moves/one-concept/issues/195), including its acceptance criteria.
