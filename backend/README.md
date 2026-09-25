# One Concept — backend

FastAPI service that owns the Gemini API key, the daily concept selection, and
every write to the database. The mobile app never talks to Gemini or Postgres
directly.

```
Mobile app  ──►  FastAPI  ──┬──►  Supabase (Postgres + Auth)
                            └──►  Gemini API
```

The API serves stored lessons, progress and achievements. Background workers
create reviewed content drafts and send timezone-aware reminders. The prepared
VM deployment is described in [the migration runbook](../docs/VM_DEPLOYMENT.md);
production remains on Railway until the owner completes the deferred cutover.

## Sustainable content lifecycle

See [the architecture](../docs/CONTENT_ARCHITECTURE.md) and
[the operator runbook](../docs/CONTENT_OPERATIONS.md). Content now uses durable
reader-aware supply targets, structured curriculum imports, explicit reviewed
publication, and separate daily reviews when new lessons are exhausted.
Run `python -m app.workers.content --help` for maintainer operations.
All migrations through 0016 must precede this backend; keep old generators disabled
during rollout. Daily review clients opt into `reviews=true` on `/v1/me/state`
and complete an identified activity through `/v1/reviews/{id}/complete`.

## Layout

```
backend/
├── app/
│   ├── main.py              app factory, CORS, JWKS lifespan
│   ├── config.py            settings; normalises the Supabase connection string
│   ├── deps.py              get_current_user — identity comes only from the token
│   ├── core/security.py     ES256 verification against the project JWKS
│   ├── db/                  async engine + models mirroring the migrations
│   ├── schemas/             request/response models
│   ├── services/
│   │   ├── selection.py     the daily concept algorithm
│   │   └── users.py         profile bootstrap (safety net for the DB trigger)
│   └── api/v1/              health, topics, daily
├── migrations/          # plain SQL, applied in filename order
├── email-templates/     # account email HTML installed manually in Supabase Auth
├── tests/               # unit and disposable PostgreSQL integration tests
├── operations/          # VM controller, Compose, Caddy and systemd timers
├── schema/contract.json # reviewed metadata used by the read-only deploy gate
├── Dockerfile           # API and all jobs, immutable revision, non-root user
└── .env.example         # copy to .env — never commit the filled copy
```

## Running locally

```bash
cd backend
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env
# Fill .env with a DEVELOPMENT Supabase project before starting.
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

`http://localhost:8000/docs` lists the endpoints (disabled in production).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | no | Bounded DB readiness and deployed revision. |
| GET | `/health/operations` | no | Safe VM/worker aggregate; 503 until current evidence exists. |
| GET | `/v1/topics` | yes | Active topics, concept counts, and whether you follow each. |
| GET | `/v1/daily` | yes | Today's concept. Creates the assignment on first call, idempotent after. |
| POST | `/v1/daily/complete` | yes | Mark today learned. Server sets the timestamp and the day it counts for. |
| GET | `/v1/me/state?compact=true` | yes | Startup state with at most 50 learned/saved detail rows, full membership and totals, and today's lesson. |
| GET | `/v1/me/history` | yes | Completed concepts, newest assigned day first; cursor pagination. |
| GET | `/v1/me/saved` | yes | Saved metadata, newest save first; cursor pagination. |
| GET | `/v1/me/stats` | yes | Streaks alone, for other consumers. |
| PUT | `/v1/me/topics` | yes | Replace the followed set (whole-list semantics, so retries are safe). |
| PATCH | `/v1/me` | yes | Display name and timezone. Unknown zones are rejected. |
| GET/PUT | `/v1/me/notifications` | yes | Reminder preferences: enabled flag and 1–3 daily times. |
| POST | `/v1/me/push-token` | yes | Register (or re-home) this handset's Expo push token. |
| DELETE | `/v1/me/push-token` | yes | Deregister on sign-out; scoped to the caller's own registration. |
| PUT/DELETE | `/v1/concepts/{slug}/like` | yes | Like / unlike. |
| PUT/DELETE | `/v1/concepts/{slug}/save` | yes | Save / unsave. |

`GET /v1/daily` returns `409` with `reason: "catalog_exhausted"` once a user has
been assigned every published concept. New assignments never repeat a concept
for that user. Review-aware clients request `reviews=true` on state and receive
a separate daily review if eligible; complete it with `POST /v1/reviews/{id}/complete`.
`GET /v1/me/achievements` reads permanent earned milestones and
`POST /v1/me/achievements/seen` records celebration acknowledgement.
See [achievements](../docs/ACHIEVEMENTS.md) for the exact contract.

## Startup and collection pagination

Updated mobile clients send `compact=true` on `GET /v1/me/state`,
`PUT /v1/me/topics`, and `PATCH /v1/me`. Each response embeds at most 50 learned
and 50 saved detail records. Full `likes` and `bookmarks` slug arrays, streaks,
and `stats.total_learned` remain authoritative. `learned_before_window` groups
older completions by topic name; add those counts to the recent learned rows
for category totals, including any optimistic offline completion.

Continue from `history_next_cursor` or `saved_next_cursor` using the matching
collection endpoint. Each returns `{items, next_cursor}`; a null cursor means
there are no more rows. Both accept `limit` (default 50, range 1–100) and an
optional `cursor`. History uses the last assigned date; Saved uses an opaque
save-timestamp/UUID cursor so tied timestamps and deletions do not skip rows.
Keep cursors unchanged and URL-encode them. All queries use the verified user.
Pages are live reads: refresh startup state to see new saves/completions made
above an existing cursor while paging.

The limit applies before per-concept like-count enrichment. Bare membership
arrays and aggregate calculations still grow with account activity. Older
clients that omit `compact=true` keep the full legacy detail response during
backend/OTA rollout; their startup cost is unchanged until updated. The mobile
History screen pages older lessons and retains downloaded content offline.
Saved loads older metadata only when opened, preserving search/category filters,
and caches it for offline use. Downloaded lesson bodies also supply missing
metadata offline, even if Saved was never opened before.

## Authentication

The project signs tokens with **ES256**, so the API verifies them against the
published JWKS and ignores the legacy shared secret. Keys are cached in process
and refetched when an unseen key id appears, so rotation needs no redeploy.
Pinning the algorithm is deliberate: it is what defeats `alg: none` and HS256
confusion attacks, both of which are covered by tests.

`user_id` is taken from the verified token's `sub` claim and from nowhere else.
No endpoint accepts a user id as a parameter.

Supabase Auth sends signup, recovery, and enabled security notifications using
the project's configured sender. See [Email templates](../docs/EMAIL_TEMPLATES.md)
for the three branded HTML files and manual installation steps. An app deployment
does not publish these templates or change SMTP settings.

## Content generation

Gemini writes lessons. It does **not** choose subjects.

```text
reviewed subjects and curriculum titles
        ↓
reader-aware supply target and bounded worker/demand wake
        ↓
claim title and reserve shared quota, then commit
        ↓
Gemini creates a validated draft revision
        ↓
human inspects and publishes the exact revision
        ↓
GET /v1/daily serves stored published rows
```

The catalog is shared, while assignment history is per user. The floor of 25
published lessons per subject is a bootstrap setting, not a lifetime ceiling.
Continuing supply targets account for the most experienced active readers.
New drafts never automatically become visible lessons. Reading requests never
wait for Gemini; background wakes respect the same switches and budget.

Run the worker with `python -m app.workers.pool_topup`. The VM runbook schedules
it daily, reminders every 15 minutes and content observations hourly. On the VM,
use `sudo one-concept run-job pool_topup` only after scheduler ownership has been
activated. Concurrent claim attempts cannot spend the same title reservation.

### Safety rails

| Control | Effect |
|---|---|
| `GENERATION_ENABLED` | Master switch. Nothing calls Gemini when false. |
| `GENERATION_DAILY_CALL_CAP` | Shared daily reservation ceiling across scheduled refill, on-demand prefetch, and catalog rewriting; zero stops new calls. |
| `attempts < 3` | A title that keeps failing is retired rather than blocking the queue. |
| Validation | Malformed output leaves the item pending; it never reaches a reader. |
| `GENERATION_ON_DEMAND` | Allows background refill when a user has few unread lessons. |

### Shared generation budget

`generation_daily_usage` stores committed call reservations, one row per Pacific
calendar day. PostgreSQL computes the day in `America/Los_Angeles`, matching
[Gemini's midnight Pacific RPD reset](https://ai.google.dev/gemini-api/docs/rate-limits),
including daylight saving time. User assignment/streak timezones are unchanged.
The atomic UPSERT prevents competing API/worker processes from spending the same
last slot. Restarts and repeated job runs retain usage; a new day gets a new row.

`generate_one` claims the backlog title and reserves quota in one transaction,
then commits before calling Gemini. An exhausted budget rolls back the title
claim and attempt. Once committed, failed responses, rate limits, cancellation,
or a worker crash keep the reservation; uncertain provider calls must not be
refunded. Gemini throttling still refunds the separate **backlog retry attempt**.
Empty backlog does not consume quota. Database/reservation failures stop generation
before the provider call. The manual rewrite worker uses the same ledger and
respects `GENERATION_ENABLED`; unfinished lessons retain their old prompt version
for a later run. Daily reading remains independent of generation.

Set the **same `GENERATION_DAILY_CALL_CAP` on the API and every worker** sharing
this database. Changing it does not erase existing usage. This is an application
budget, not a provider quota lookup: other applications using the same Gemini
project are outside this ledger, and provider rate/token limits still apply.

**Before enabling generation:** verify all required migrations, including
[`0010_generation_daily_usage.sql`](migrations/0010_generation_daily_usage.sql),
using the migration procedure in [RELEASING.md](../RELEASING.md). The production
ledger remains unchanged until actual application is verified. Earlier application
versions do not use this counter, and calls made before deployment cannot be
reconstructed from it. Pause old generators during rollout; enable the new code
at the next Pacific reset, or conservatively seed today's usage while generation
is paused, to avoid granting another allowance in the middle of the day.

Inspect reservations without changing them:

```sql
select budget_day, calls_used
from public.generation_daily_usage
order by budget_day desc
limit 7;
```

### Fallback ladder in `/v1/daily`

1. An unseen concept in a followed topic.
2. If that pool is dry, schedule a background refill and immediately widen to
   the whole catalog, flagging `outside_followed_topics`.
3. If nothing unseen remains, return `409 catalog_exhausted`. A concept is never
   repeated. A low unread watermark can also schedule refill before exhaustion.

## Latency and database region

Response time is dominated by round trips to the database, not by query cost.
Measured against a Supabase project in `ap-northeast-1` from Europe, a single
round trip is 160–1100 ms — so the code is written to minimise the *number* of
statements rather than their complexity:

- The state aggregate is **one query**, returning follows, recent detail rows,
  membership, assignment slug, and full streaks/totals. Bootstrapping only runs
  when no profile exists. The `/v1/me/state` handler separately resolves today's
  lesson, folding it into the same HTTP response.
- Follow updates are one statement (a data-modifying CTE), not one per topic.
- Connection pooling is on. Without it every request paid a fresh TCP + TLS +
  auth handshake to the database region, which cost seconds.

Geography and connection reuse both affect latency. **Deploy the API close to
the database**, then compare fresh, immediately reused, and post-idle requests.
Timing a slow query alone does not establish that a new connection was opened.

The API runs a best-effort `SELECT 1` probe immediately on startup and then
every `DB_KEEPALIVE_INTERVAL_SECONDS` (default 30 seconds, measured after each
probe finishes). It borrows from the same pool as requests and promptly returns
the connection, rolling back the implicit transaction. The pool reuses its most
recently returned connection, so low traffic can use a warm slot while surplus
idle slots expire. `pool_pre_ping` remains enabled for dead connections.

`DB_KEEPALIVE_TIMEOUT_SECONDS` (default 5 seconds) bounds checkout, reconnect,
and query together. Rollback/return has a separate budget of the same duration;
failed cleanup invalidates the connection. A failed attempt logs only the
exception type and retries after the interval; it does not block API startup.
Shutdown cancels the task before disposing the engine. Set the interval to `0`
to disable probes. Each API
process runs its own task; importing the engine in cron workers starts no task.
Pool size and overflow limits remain 5 each. A cold startup or a burst requiring
additional connections can still pay connection setup time.

Reproduce idle expiry without production services using:

```bash
DATABASE_URL=postgresql+asyncpg://postgres:postgres@127.0.0.1:55433/postgres \
SUPABASE_URL=http://test.invalid SUPABASE_JWKS_URL=http://test.invalid/jwks \
GENERATION_ENABLED=false GEMINI_API_KEY= \
  .venv/bin/python -m pytest tests/test_db_keepalive_postgres.py -q -s
```

The PostgreSQL 16 tests set short idle expiry only on their own sessions and
compare connection counts and request timings with warming disabled/enabled.
They also check transaction cleanup and recovery from a terminated connection.
These timings describe the local test environment, not deployed Supavisor latency.

## Connection strings

Two are needed, and they are not interchangeable:

- **`DATABASE_URL`** — transaction pooler (6543), used by the API. `config.py`
  strips a `?pgbouncer=true` suffix (a Prisma convention that asyncpg rejects)
  and disables prepared statements, which is what a transaction pooler requires.
- **`DIRECT_URL`** — session pooler (5432), used for read-only schema checks and
  deliberate migrations/DDL. It must point to the same project as `DATABASE_URL`.

## Tests and required checks

Use Python 3.12, Node 24 for the mobile project, and a working Docker or Podman
engine. The suite creates its own PostgreSQL 16 container on a random loopback
port, applies all migrations and overrides provider configuration with test
values. It never accepts a production database URL as its integration target.

```bash
.venv/bin/python -m ruff check --select F,E9 app tests operations
TEST_CONTAINER_ENGINE=podman TEST_REQUIRE_DATABASE=1 .venv/bin/python -m pytest -ra
# Use TEST_CONTAINER_ENGINE=docker with Docker instead.
```

`TEST_REQUIRE_DATABASE=1` turns unavailable PostgreSQL into a failure. Without
it, local database tests can skip; report those skips separately. CI runs the
full backend and mobile suites, then builds/tests native AMD64 and ARM64 images
with disposable PostgreSQL. See [VM branch rules](../docs/VM_DEPLOYMENT.md#github-deployment-credentials-and-branch-rules)
for the separate GitHub protection configuration.

## Applying and verifying migrations

Use a development project for local setup. Apply every pending immutable SQL
file in filename order, through Supabase SQL Editor or `psql "$DIRECT_URL" -v
ON_ERROR_STOP=1 -f migrations/FILE.sql`. Do not run only an outdated subset of
seed files. Production application is a deliberate release operation; update
`migrations/applied.txt` only after the actual effects are verified.

`python -m app.workers.schema_check` opens a bounded read-only transaction and
compares actual schema/RLS to the reviewed image contract. It never migrates or
re-seeds a database. To update the contract after a new migration, use only the
disposable test fixture:

```bash
UPDATE_SCHEMA_CONTRACT=1 TEST_REQUIRE_DATABASE=1 \
  .venv/bin/python -m pytest -q tests/test_schema_contract.py
```

Review the changed metadata in the PR. Never baseline production to hide a
missing migration, RLS policy or constraint. See [RELEASING.md](../RELEASING.md).

## What the schema guarantees

Two constraints on `daily_assignments` carry most of the product requirements:

| Constraint | Guarantee |
|---|---|
| `unique (user_id, assigned_for)` | exactly one concept per user per day |
| `unique (user_id, concept_id)` | a concept is never assigned to the same user twice |

The second one is the no-repeat requirement expressed as a database invariant,
so a repeat is impossible even under a race, a retry, or a future bug. The same
table doubles as learning history (`completed_at is not null` means learned),
which is what makes the streak query and the notification stop-condition cheap.

Streaks are always derived from completed dates — never stored as a counter and
never accepted from the client.

## Verification

These migrations were applied to a throwaway PostgreSQL 16 instance and checked:
seed counts, the new-user trigger, both unique constraints rejecting duplicates,
`on conflict do nothing` handling the concurrent-device race, the eligible-pool
query, the gaps-and-islands streak query across three scenarios (today complete,
today pending, day missed), and RLS isolation between two users.

## API protection and deployment

Verified JWT subjects have separate read/write token buckets (defaults 120/60
per minute). Rejections use 429 plus `Retry-After`; malformed tokens never
consume another account's bucket. The bounded in-memory limiter uses one API
process. Restarts reset these soft limits; scaling to more workers/VMs requires
a shared limiter. It is not DDoS protection or the provider-spend boundary;
generation still uses the durable database quota.

[VM_DEPLOYMENT.md](../docs/VM_DEPLOYMENT.md) covers the complete API/proxy,
workers, environment, hostname/client compatibility, monitoring, rollback and
remaining owner setup. `railway.json` remains for the currently running service
and transition recovery. No Railway service is deleted by this PR.

Set `ENVIRONMENT=production` to disable `/docs` and `/openapi.json`. The image
runs as UID 10001, has no embedded credentials and exposes safe revision health.
GitHub deployment and manual mobile Release are separate; publication verifies
actual schema, current workers and the public endpoint before sending an OTA.
