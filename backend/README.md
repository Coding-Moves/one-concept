# One Concept — backend

FastAPI service that owns the Gemini API key, the daily concept selection, and
every write to the database. The mobile app never talks to Gemini or Postgres
directly.

```
Mobile app  ──►  FastAPI  ──┬──►  Supabase (Postgres + Auth)
                            └──►  Gemini API
```

Status: **Phase 7 — reminders.** Reads, writes, Gemini generation from a
curated backlog, and timezone-aware push reminders that stop once the day is
learned.

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
├── tests/               # 25 tests: token verification, selection, HTTP
├── Dockerfile           # what Railway builds
└── .env.example         # copy to .env — never commit the filled copy
```

## Running locally

```bash
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

`http://localhost:8000/docs` lists the endpoints (disabled in production).

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/health` | no | Liveness + a real query. Also the keep-alive ping target. |
| GET | `/v1/topics` | yes | Active topics, concept counts, and whether you follow each. |
| GET | `/v1/daily` | yes | Today's concept. Creates the assignment on first call, idempotent after. |
| POST | `/v1/daily/complete` | yes | Mark today learned. Server sets the timestamp and the day it counts for. |
| GET | `/v1/me/state` | yes | Everything the app renders: follows, history, likes, saves, streaks. One query. |
| GET | `/v1/me/stats` | yes | Streaks alone, for other consumers. |
| PUT | `/v1/me/topics` | yes | Replace the followed set (whole-list semantics, so retries are safe). |
| PATCH | `/v1/me` | yes | Display name and timezone. Unknown zones are rejected. |
| GET/PUT | `/v1/me/notifications` | yes | Reminder preferences: enabled flag and 1–3 daily times. |
| POST | `/v1/me/push-token` | yes | Register (or re-home) this handset's Expo push token. |
| DELETE | `/v1/me/push-token` | yes | Deregister on sign-out; scoped to the caller's own registration. |
| PUT/DELETE | `/v1/concepts/{slug}/like` | yes | Like / unlike. |
| PUT/DELETE | `/v1/concepts/{slug}/save` | yes | Save / unsave. |

`GET /v1/daily` returns `409` with `reason: "catalog_exhausted"` once a user has
been assigned every published concept — it never repeats one. Phase 6 hooks
Gemini generation in at that point.

## Authentication

The project signs tokens with **ES256**, so the API verifies them against the
published JWKS and ignores the legacy shared secret. Keys are cached in process
and refetched when an unseen key id appears, so rotation needs no redeploy.
Pinning the algorithm is deliberate: it is what defeats `alg: none` and HS256
confusion attacks, both of which are covered by tests.

`user_id` is taken from the verified token's `sub` claim and from nowhere else.
No endpoint accepts a user id as a parameter.

## Content generation

Gemini writes lessons. It does **not** choose subjects.

```
curated backlog (150 titles)
        ↓
worker: is a topic below MIN_POOL_PER_TOPIC published concepts?
        ↓
Gemini writes {summary, example} for one backlogged title
        ↓
validate — length bounds, no boilerplate opener, no code fence,
           example must not restate the summary
        ↓
INSERT INTO concepts (status='published', source='gemini',
                      model, prompt_version)
        ↓
GET /v1/daily serves stored rows. It never calls Gemini on the happy path.
```

Curating titles up front is what makes deduplication trivial — a unique slug —
and keeps the syllabus deliberate instead of drifting towards whatever the model
finds popular. The catalog is global, so one generated lesson serves every user;
that is the largest cost lever in the design.

Run the worker:

```bash
python -m app.workers.pool_topup
```

On Railway, add this as a **cron job** on the same service (daily is plenty).
It is safe to run concurrently: backlog items are claimed with
`FOR UPDATE SKIP LOCKED`, so two workers never write the same title.

### Safety rails

| Control | Effect |
|---|---|
| `GENERATION_ENABLED` | Master switch. Nothing calls Gemini when false. |
| `GENERATION_DAILY_CALL_CAP` | Hard ceiling per run, so a retry loop cannot burn the quota. |
| `attempts < 3` | A title that keeps failing is retired rather than blocking the queue. |
| Validation | Malformed output leaves the item pending; it never reaches a reader. |
| `GENERATION_ON_DEMAND` | Last-resort in-request generation when one user's pool is dry. |

### Fallback ladder in `/v1/daily`

1. An unseen concept in a followed topic.
2. Failing that, generate one in the user's least-recently-seen followed topic.
3. Failing that, widen to the whole catalog and flag `outside_followed_topics`.
4. Failing that, return `409 catalog_exhausted`. A concept is never repeated.

## Latency and database region

Response time is dominated by round trips to the database, not by query cost.
Measured against a Supabase project in `ap-northeast-1` from Europe, a single
round trip is 160–1100 ms — so the code is written to minimise the *number* of
statements rather than their complexity:

- `/v1/me/state` is **one query**. It returns follows, history, likes, saves,
  today's assignment, and streaks together, and bootstrapping only runs when
  that query finds no profile.
- Follow updates are one statement (a data-modifying CTE), not one per topic.
- Connection pooling is on. Without it every request paid a fresh TCP + TLS +
  auth handshake to the database region, which cost seconds.

The remaining latency is geography. **Deploy the API in the same region as the
database** — on Railway, pick the region closest to your Supabase project — and
these round trips drop to single-digit milliseconds.

## Connection strings

Two are needed, and they are not interchangeable:

- **`DATABASE_URL`** — transaction pooler (6543), used by the API. `config.py`
  strips a `?pgbouncer=true` suffix (a Prisma convention that asyncpg rejects)
  and disables prepared statements, which is what a transaction pooler requires.
- **`DIRECT_URL`** — session pooler (5432), used for migrations and DDL.

## Tests

```bash
.venv/bin/python -m pytest
```

Token tests run offline against a locally minted ES256 keypair. Selection tests
run against a throwaway PostgreSQL started with podman and the project's own
migration files, so constraints and races are exercised for real; they skip if
podman is unavailable.

## Applying the migrations

Create a Supabase project first (one for `dev`, one for `prod` later), then
either paste each file into the SQL Editor in filename order, or:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0001_schema.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0002_rls.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0003_seed_topics.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0004_seed_concepts.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0005_concept_backlog.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0006_seed_backlog.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f migrations/0007_reminder_log.sql
```

Applying only through `0004` leaves a schema with no generation backlog and no
reminder log — the pool worker and the reminders worker both need the later
files. Each file is wrapped in a transaction, and the seeds are idempotent —
re-running them updates rows in place rather than duplicating.

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

## Deployment

**Railway**, from `backend/Dockerfile` (see `railway.json`). Set every variable
from `.env.example` in Railway's variable store — never in the image, never in
git. Point the health check at `/health`, and set `ENVIRONMENT=production` to
disable both `/docs` and `/openapi.json` (the raw schema). A cron worker for
pool top-up and reminders joins later, in Phases 6 and 7.
