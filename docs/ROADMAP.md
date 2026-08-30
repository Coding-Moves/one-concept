# Roadmap

Development moves in small, complete phases. Shipped phases are checked.

## Phase 1 — Foundation ✅

- [x] Mobile application (Expo / React Native)
- [x] Initial UI and daily concept display
- [x] Local state and project architecture

## Phase 2 — Daily Learning ✅

- [x] AI-generated concepts from a curated backlog
- [x] Concept storage, no repeats per user
- [x] Learning history and completion tracking

## Phase 3 — Backend ✅

- [x] FastAPI service; LLM credentials never reach the client
- [x] Supabase authentication (ES256 / JWKS)
- [x] Server-side writes and data sync

## Phase 4 — Streaks ✅

- [x] Daily and longest streak, total learned, stats

## Phase 5 — Content Engine ✅

- [x] Gemini generation with validation and rate-limit backoff
- [x] Nightly pool top-up worker
- [x] Human-voice prompt (v2): 2–3 plain sentences plus one concrete example

## Phase 6 — Deployment ✅

- [x] Backend on Railway (auto-deploys from `main`)
- [x] EAS Build (APK) and EAS Update (OTA on merge)
- [x] GitHub Actions automation

## Phase 7 — Notifications ✅

- [x] Push reminders via Expo + FCM
- [x] Up to three timezone-aware reminder times per user
- [x] Reminders stop once the day's concept is learned

## Future

- [ ] Quizzes
- [ ] Search across learned concepts
- [ ] Difficulty levels and personalized learning
- [ ] Spaced repetition
- [ ] Achievements, weekly summaries, monthly reports
- [ ] Multiple languages, offline reading, web application
