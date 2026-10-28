# Architecture

```text
Mobile app (Expo / React Native)
        |
        v
Supabase Edge API ───────────┬──► Supabase (Postgres + Auth)
                             └──► private editorial operations
Supabase Cron → Edge worker ─────► Expo Push / Gmail HTTPS / Gemini
```

The mobile app uses Supabase Auth for sessions and calls the Edge API for app
data. It never talks to Gemini or Postgres directly. The API owns data writes
and daily selection; scheduled generation and notifications run through the
Edge worker. See [backend/README.md](../backend/README.md) for the shared API
contract and local Python maintenance implementation.

## Concept selection — no repeats

Selection excludes everything a user has already been assigned, and rotates
topics so a week feels varied:

```text
Published concepts in followed topics
  − concepts already assigned to this user
  → prefer the topic seen least recently
  → assign, save to history
```

When a user has read all published lessons in their followed topics, the app
offers scheduled reviews. New lesson generation is a bounded background process
from a human-planned backlog. It can stop for an empty plan, a full review queue,
provider limits, or a disabled gate; learner requests do not wait for Gemini.

## Lessons

Gemini drafts lessons from curated titles; it does not choose subjects. Output
is validated and remains private until a human reviews and publishes the full
lesson package. Failed plans have bounded retries and require diagnosis before
an operator grants another attempt.

## Reminders

Up to three reminder times per user, interpreted in the user's own timezone.
A Supabase scheduled worker checks due slots, claims each (user, day, slot)
occurrence in a log table before pushing — so a crash or overlapping run can
miss a nudge but never send a duplicate — and stops the moment the user marks
the concept learned. If the learner follows no active topic, the worker preserves
their reminder preferences and device tokens but does not claim a topic-dependent
daily nudge; following an active topic resumes normal delivery. Due-ness is
computed on full timestamps: a slot shortly
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
| API | Supabase Edge Function with PostgreSQL RPCs |
| Database & auth | Supabase (Postgres) |
| AI | Gemini (flash-lite) |
| Push | Expo Notifications + Firebase Cloud Messaging |
| Scheduled work | Supabase Cron + Edge worker |
| CI/CD | GitHub Actions, EAS Build + Update |
