# Achievements

Achievements recognize sustained learning without making any reward mandatory. Streak awards recognize 7, 30, 90, 180, 365, 500, 1,000, 5,000 and 10,000 consecutive learning days. The expanded catalog also recognizes completed concepts (1, 5, 10, 25, 50, 100), completed reviews (1, 5, 10, 25, 50, 100), distinct weekly quizzes (1, 5, 10, 25, 50), perfect weekly quiz scores (1, 5), and distinct completed learning paths (1, 5, 10, 25). They remain earned after activity changes. Device timestamps and client counters cannot award badges.

## Server architecture

- `achievement_definitions`: stable code, category, metric, threshold, requirement
  metadata, title, description, artwork key, display order and progress visibility.
  `user_achievements`: user, achievement code, first qualifying date, recording
  time, origin and acknowledgement time.
- The shared server evaluator derives every award from immutable accepted records:
  completed concepts, completed reviews, first attempt for each weekly quiz,
  first perfect attempt for each weekly quiz, and first completion for each
  subtopic. It never trusts a mobile counter. A retry, a second device, or a new
  catalog signature for an already completed subtopic cannot inflate a metric.
- The composite user/code primary key prevents duplicate awards. Accepted lesson
  and review writes already hold the profile lock; weekly quiz submission now
  takes that same lock before writing its immutable attempt. Award insertion
  remains in the surrounding transaction, so a failed award rolls back the write.
- Migration 0027 adds the expanded definitions and backfills their actual first
  qualifying date. Collection reads reconcile under the profile lock to catch
  records accepted by an older API or newly introduced definitions. Conflicts
  preserve existing earned dates and acknowledgements.
- `GET /v1/me/achievements` returns definitions, own awards and confirmed current/
  longest streaks. `POST /v1/me/achievements/seen` acknowledges up to 100 codes.
  Both use JWT identity; acknowledgement cannot create an award.
- RLS permits authenticated catalog/own-award reads only. Direct client writes
  have no policy. The API owns awarding and acknowledgement.

## Mobile experience and isolation

Profile previews the collection and its nearest available target. The collection
uses server-provided progress for every visible category, not a client-derived
counter. It switches to one column on narrow screens or with larger system text.
Locked artwork is hidden behind a lock silhouette; milestone requirements and
confirmed progress remain readable and locked cards do not open. Earned badges
use local vector artwork and static accent rings. Detail sheets support
scrolling, Android Back and reduced motion.

One grouped celebration covers unseen confirmed awards, including historical
credit. It waits for What's New to close. Continuing dismisses the group; the
collection remains available. The device remembers dismissal and retries server
acknowledgement on refresh. Once acknowledged, dismissal survives reinstalls and
other devices after refresh. Two devices that fetched before acknowledgement
may both show it initially: there is no distributed exactly-once presentation
claim. Signing out before an offline dismissal reaches the server can cause the
celebration to reappear after signing in.

The provider is keyed by user ID. Replacement accounts immediately get new UI
state. Requests verify the expected user against the token provider. Account
cache keys, disposed-store checks and cache epochs fence late reads, writes and
responses. Sign-out clears this cache through the shared cleanup registry.
Offline completion never awards locally; only accepted server history unlocks
badges. Cached viewing remains available.

## Extension rules

Add definitions through a new ordered migration. Keep existing codes, metrics and
thresholds stable: changing them changes the meaning of earned awards. Every new
metric needs an accepted server record, an evaluator fact query, an honest
requirement description and regression coverage for replay and first-earned
semantics. Add artwork mappings if desired; unknown artwork has a generic medal
fallback. Screens do not hardcode the number of milestones.

The catalog, award storage, ownership, caching, acknowledgement and detail
components remain reusable. A new category must return server-confirmed progress
where that progress is meaningful; it must not add a local or AI-estimated score.

## Rollout

1. Review and apply `backend/migrations/0027_expanded_achievements.sql` using the normal
   migration/backup procedure after 0016–0026. This PR has not applied it to production.
2. Verify the tables, policies, 32 definitions and historical awards. Only
   then record the migration in `backend/migrations/applied.txt`.
3. Deploy the API before the mobile update. Existing completion response shapes
   are unchanged and older clients remain compatible.
4. Smoke-test collection/acknowledgement with a test account, then follow the
   normal release process: version bump plus matching What's New entry.

There are no new native dependencies or runtime/version changes in this feature
PR. Deployment, release preparation and physical Android testing are separate.

## Validation

`backend/tests/test_achievements.py` and `test_expanded_achievements.py` use PostgreSQL to cover streak retention, concept thresholds, review/quiz/path facts, first-earned dates, replay safety, distinct quiz attempts, distinct subtopic paths, collection progress, migration/schema reconciliation, JWT ownership, acknowledgement and denied direct client writes.

`mobile/tests/achievementStore.test.mjs` covers persistence, storage failure,
offline acknowledgement retry, direct account replacement, sign-out fencing and
late results. `mobile/tests/achievements.browser.cjs` uses the exported app with
mocked APIs for themes, grouped celebrations, What's New ordering, details,
contrast, narrow/enlarged text, offline restart and an old request returning
after another account signs in. Native TalkBack, system font scaling and Android
Back still need physical-device testing.
