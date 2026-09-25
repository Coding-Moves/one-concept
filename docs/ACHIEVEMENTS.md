# Achievements

Streak awards recognize 7, 30, 90, 180, 365, 500, 1,000, 5,000 and 10,000
consecutive learning days. They remain earned after a streak ends. Lessons and
daily reviews count together, once per recorded `assigned_for` date, using the
existing streak semantics. Device timestamps and client counters cannot award badges.

## Server architecture

- `achievement_definitions`: stable code, metric, threshold, title, description,
  artwork key and display order. `user_achievements`: user, achievement code,
  first qualifying date, recording time, source and acknowledgement time.
- The composite user/code primary key prevents duplicate awards. Both completion
  services evaluate awards under their existing profile lock before committing;
  completion and awards roll back together on failure.
- Migration 0016 backfills historical consecutive-date runs, including ended
  streaks. Collection reads reconcile under the same lock to catch completions
  accepted by an older API during deployment, or newly introduced thresholds.
  Conflicts preserve existing earned dates and acknowledgements.
- `GET /v1/me/achievements` returns definitions, own awards and confirmed current/
  longest streaks. `POST /v1/me/achievements/seen` acknowledges up to 100 codes.
  Both use JWT identity; acknowledgement cannot create an award.
- RLS permits authenticated catalog/own-award reads only. Direct client writes
  have no policy. The API owns awarding and acknowledgement.

## Mobile experience and isolation

Profile previews the collection and next target. The collection switches to one
column on narrow screens or with larger system text. Locked artwork is hidden
behind a lock silhouette; milestone requirements remain readable and locked
cards do not open. Earned badges use local vector artwork and static accent
rings. Detail sheets support scrolling, Android Back and reduced motion.

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

Add streak thresholds through a new ordered migration inserting catalog rows.
Keep existing codes, metrics and thresholds stable: changing them changes the
meaning of earned awards. Add artwork mappings if desired; unknown artwork has
a generic medal fallback. Screens do not hardcode the number of milestones.

New categories need server evaluators in their accepted-write transactions,
metric-specific progress/wording and regression tests. Catalog, award storage,
ownership, caching, acknowledgement and detail components remain reusable.
The first UI deliberately describes streaks; a new metric requires appropriate
presentation as well as inserting a definition.

## Rollout

1. Review and apply `backend/migrations/0016_achievements.sql` using the normal
   migration/backup procedure. This PR has not applied it to production.
2. Verify the tables, policies, nine definitions and historical awards. Only
   then record the migration in `backend/migrations/applied.txt`.
3. Deploy the API before the mobile update. Existing completion response shapes
   are unchanged and older clients remain compatible.
4. Smoke-test collection/acknowledgement with a test account, then follow the
   normal release process: version bump plus matching What's New entry.

There are no new native dependencies or runtime/version changes in this feature
PR. Deployment, release preparation and physical Android testing are separate.

## Validation

`backend/tests/test_achievements.py` uses PostgreSQL to cover all thresholds,
first-earned dates, gaps, retention, mixed lesson/review dates, midnight grace,
duplicate days, concurrent completion, rollback, migration backfill, rollout-gap
reconciliation, JWT ownership, acknowledgement and denied direct client writes.

`mobile/tests/achievementStore.test.mjs` covers persistence, storage failure,
offline acknowledgement retry, direct account replacement, sign-out fencing and
late results. `mobile/tests/achievements.browser.cjs` uses the exported app with
mocked APIs for themes, grouped celebrations, What's New ordering, details,
contrast, narrow/enlarged text, offline restart and an old request returning
after another account signs in. Native TalkBack, system font scaling and Android
Back still need physical-device testing.
