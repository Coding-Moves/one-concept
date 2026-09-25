# Releasing One Concept

Production release flow. Keep it boring and repeatable.

## Branch model
- `develop` is the default branch; the **team's** feature/fix PRs target it.
  (This is our internal flow — the project doesn't take outside PRs; see
  [CONTRIBUTING.md](CONTRIBUTING.md).)
- `main` is production. A release is a single PR **develop → main** (no `release/*` branch).
- Merging to `main` triggers Railway backend deployment. Mobile publication is
  a separate manual run of `.github/workflows/release.yml` after verification.

## Cutting a release
1. **Bump the version on `develop` first.** Edit `mobile/app.config.js` → `expo.version`
   (the marketing version). Open a small PR into `develop` and merge it.
   - **runtimeVersion** (`expo.runtimeVersion`) is the native-ABI identity. Leave it
     UNCHANGED for a JS-only release; bump it ONLY on a native change (new native
     module, URL scheme, permission, config plugin) — that requires a new APK.
2. **What's New card — required for every release.** Automatically add a nonempty
   entry to `mobile/src/data/whatsNew.ts` matching the new version during release
   preparation. Focus on **new features and user-visible improvements**: what's
   new and what's better. Describe real benefits in a few short bullets, not error
   lists, technical diagnostics, or internal maintenance. Reuse the existing
   version-based dismissal so the card stays hidden after the user dismisses it.
   This owner instruction supersedes the earlier features-only policy in issue #97.
   **Permanent owner requirement:** every release PR must contain both the app
   version bump and the matching nonempty What's New entry in its final diff
   against `main`, even when prepared through a separate PR into `develop`.
   Before opening or marking it ready, verify both and explicitly list the
   release version, user-facing highlights and card verification in its description.
3. **Apply pending DB migrations to production** (see below) **before opening the
   release PR.**
4. Open the release PR **develop → main**. It must pass the required
   **"Migrations applied check"** and get its approval, then merge.
5. On merge, Railway auto-deploys the API from `main`. Keep generation paused
   during backend/worker transitions. Verify the new main commit is deployed to
   the API and workers, `/health` succeeds, and the release-specific smoke checks
   pass. Do not resume old generators against the new editorial schema.
6. Open **GitHub Actions → Release → Run workflow**, select **main**, and enter
   the full 40-character main commit SHA you verified on production API/workers
   in `backend_revision`. This is an operator attestation; the workflow does not
   inspect Railway deployments itself. Do not submit it until checks are complete.
7. The workflow rejects another branch, an older deployment or a main revision
   that advanced before validation. It then publishes production + preview OTA,
   cuts the version tag/GitHub Release, and dispatches the native-gated APK build.
   Do not merge another release while publication is running. The standalone
   EAS Update workflow publishes preview only; production uses this release path.

## Database migrations — MANUAL, every release
The deploy does **not** auto-migrate. Files in `backend/migrations/*.sql` must be run
by hand against the production Supabase DB, or the app queries columns/tables that
don't exist (this caused the `pool-topup` "column claimed_at does not exist" crash).

For each migration not yet applied to prod:
1. Run it — Supabase → **SQL Editor** (paste the file), or
   `psql "$DIRECT_URL" -f backend/migrations/<file>` (`DIRECT_URL` = the 5432 session pooler).
2. Add its filename to **`backend/migrations/applied.txt`**.

`.github/workflows/migrations.yml` fails on `main` and on release PRs if any migration
isn't listed in `applied.txt`. It is a **required** check on `main`, so a release
cannot merge with an unapplied migration. Migrations are immutable once applied —
never edit an applied file; add a new one.

## After a JS-only release
Installed apps update over the air on next launch — no reinstall. The stable APK
download link in the README changes only on a native (runtimeVersion) release.

## One-time backend config (already set in production)
- `SUPABASE_ANON_KEY` on the Railway `api` service — the `/reset-password` page needs it.
- Supabase → Auth → Redirect URLs must include `<api-domain>/reset-password`.
