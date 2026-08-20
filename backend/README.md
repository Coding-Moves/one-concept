# One Concept — backend

FastAPI service that owns the Gemini API key, the daily concept selection, and
every write to the database. The mobile app never talks to Gemini or Postgres
directly.

```
Mobile app  ──►  FastAPI  ──┬──►  Supabase (Postgres + Auth)
                            └──►  Gemini API
```

Status: **Phase 1 — database only.** The migrations below are complete and
tested; the FastAPI application itself lands in Phase 2.

## Layout

```
backend/
├── migrations/          # plain SQL, applied in filename order
│   ├── 0001_schema.sql          tables, indexes, constraints, new-user trigger
│   ├── 0002_rls.sql             row level security policies
│   ├── 0003_seed_topics.sql     the five topics
│   └── 0004_seed_concepts.sql   the 20 prototype concepts (generated)
└── .env.example         # copy to .env — never commit the filled copy
```

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

## Deployment (Phase 2)

Target is **Railway**: the FastAPI container plus a cron worker for pool top-up
and reminders. Secrets go in Railway's variable store — never in the image, never
in git.
