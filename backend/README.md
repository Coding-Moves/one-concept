# One Concept — backend

FastAPI service that owns the Gemini API key, the daily concept selection, and
every write to the database. The mobile app never talks to Gemini or Postgres
directly.

```
Mobile app  ──►  FastAPI  ──┬──►  Supabase (Postgres + Auth)
                            └──►  Gemini API
```

Status: **Phase 2 — the API serves the daily concept.** Reads only; writes
(complete, follow, like, save) arrive in Phase 4.

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
```

Each file is wrapped in a transaction, and the seeds are idempotent — re-running
them updates rows in place rather than duplicating.

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
disable `/docs`. A cron worker for pool top-up and reminders joins later, in
Phases 6 and 7.
