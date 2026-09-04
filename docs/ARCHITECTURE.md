# Architecture

```text
Mobile app (Expo / React Native)
        |
        v
FastAPI backend (Railway) ──┬──► Supabase (Postgres + Auth)
                            └──► Gemini API
```

The mobile app never talks to Gemini or Postgres directly. The backend owns
the API key, every write, and the daily selection. See
[backend/README.md](../backend/README.md) for endpoints and auth details.

## Concept selection — no repeats

Selection excludes everything a user has already been assigned, and rotates
topics so a week feels varied:

```text
Published concepts in followed topics
  − concepts already assigned to this user
  → prefer the topic seen least recently
  → assign, save to history
```

When a user has read everything in their topics, the backend generates one
new lesson on demand; a nightly worker keeps every topic stocked to 25 ahead
of time so nobody normally waits on a model.

## Lessons

Gemini writes lessons; it never chooses subjects — titles come from a curated
backlog. Every lesson is 2–3 plain sentences plus one concrete example, and
output is validated (length bounds, banned filler words) before publishing.
Rejected output is retried later, never shown to a user.

## Reminders

Up to three reminder times per user, interpreted in the user's own timezone.
A worker runs every 15 minutes on Railway, claims each due (user, day, slot)
occurrence in a log table before pushing — so a crash or overlapping run can
miss a nudge but never send a duplicate — and stops the moment the user marks
the concept learned. Due-ness is computed on full timestamps: a slot shortly
before midnight caught by the first run after it still fires, and is claimed
against the day it was scheduled for — so a reminder_log row dated
"yesterday" is expected, not a bug. Delivery is Expo push over FCM.

## Streaks and history

Completion is recorded server-side with the day computed in the user's
timezone. Streaks (current, longest, total learned) are derived by SQL from
the completion history — a gaps-and-islands query, no counters to drift.

## Security

- The Gemini key and service-role credentials live only in server env vars.
- Identity comes only from the verified Supabase JWT (`sub` claim); no
  endpoint accepts a user id as a parameter.
- Tokens are verified as ES256 against the project JWKS; algorithm pinning
  defeats `alg: none` and HS256-confusion attacks (covered by tests).
- Row Level Security is enabled as a second lock behind the backend.

## Stack

| Layer | Technology |
|---|---|
| Mobile | Expo SDK 57, React Native, TypeScript |
| Backend | Python, FastAPI, SQLAlchemy (async) |
| Database & auth | Supabase (Postgres) |
| AI | Gemini (flash-lite) |
| Push | Expo Notifications + Firebase Cloud Messaging |
| Hosting | Railway (API + cron workers) |
| CI/CD | GitHub Actions, EAS Build + Update |
