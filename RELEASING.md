# Releasing One Concept

Production release flow. Keep it boring and repeatable.

## Branch model
- `develop` is the default branch; the **team's** feature/fix PRs target it.
  (This is our internal flow — the project doesn't take outside PRs; see
  [CONTRIBUTING.md](CONTRIBUTING.md).)
- `main` is production. A release is a single PR **develop → main** (no `release/*` branch).
- Merging to `main` triggers `.github/workflows/release.yml`.

## Cutting a release
1. **Bump the version on `develop` first.** Edit `mobile/app.config.js` → `expo.version`
   (the marketing version). Open a small PR into `develop` and merge it.
   - **runtimeVersion** (`expo.runtimeVersion`) is the native-ABI identity. Leave it
     UNCHANGED for a JS-only release; bump it ONLY on a native change (new native
     module, URL scheme, permission, config plugin) — that requires a new APK.
2. **What's New card.** Add an entry to `mobile/src/data/whatsNew.ts` for the new
   version. **Features only** — no bug fixes / UI tweaks / removals (issue #97).
3. **Apply pending DB migrations to production** (see below) **before opening the
   release PR.**
4. Open the release PR **develop → main**. It must pass the required
   **"Migrations applied check"** and get its approval, then merge.
5. On merge, `release.yml` publishes the production + preview OTA, cuts the `vX.Y.Z`
   tag + GitHub Release, and dispatches the APK build (which **skips** unless
   runtimeVersion changed). Railway auto-deploys the `api` service from `main`.

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
