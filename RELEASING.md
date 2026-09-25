# Releasing One Concept

Production release flow. Cloud setup for #169 is deferred; its implementation
PR remains draft. Before a release containing that migration, complete
[VM_DEPLOYMENT.md](docs/VM_DEPLOYMENT.md), including protected deployment access,
hostname compatibility, schema verification and exactly one scheduler owner.
Do not dispatch a production release while that setup is pending.

## Branch model
- `develop` is the default branch; the **team's** feature/fix PRs target it.
  (This is our internal flow — the project doesn't take outside PRs; see
  [CONTRIBUTING.md](CONTRIBUTING.md).)
- `main` is production. A release is a single PR **develop → main** (no `release/*` branch).
- `main` runs **Backend deploy** when `VM_DEPLOY_ENABLED=true`; a manual main
  dispatch is available for an approved first cutover. It tests/builds an immutable
  image and deploys through the protected environment. Existing Railway automation
  remains a live external setting until the owner changes it during cutover.
- Mobile publication remains a separate manual **Release** run after verification.

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
5. Deploy the current main SHA through **Backend deploy** after the owner approves
   the protected `production-backend` environment. A schema failure leaves the
   existing service untouched. Generation remains paused after deployment.
   On first cutover, disable all old dispatchers/demand generation and explicitly
   activate VM schedules. Verify healthy API, current successful worker runs,
   public HTTPS and old/new client/auth-link compatibility. Subsequent deployments
   preserve scheduler ownership but again pause generation for inspection.
6. Open **GitHub Actions → Release → Run workflow**, select **main**, and enter
   the exact full main commit SHA as `backend_revision`. The workflow verifies the
   attestation, then reads the actual VM schema, API and worker evidence through
   restricted SSH. It also verifies public TLS/revision and requires both EAS
   environments' API URLs to match `PUBLIC_API_ORIGIN`. An unhealthy backend,
   incomplete schema, stale worker, missing credential or wrong endpoint blocks OTA.
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
2. Independently verify the actual schema effects, then add its filename to
   **`backend/migrations/applied.txt`**. Never record application merely to pass CI.

`.github/workflows/migrations.yml` fails on `main` and on release PRs if any migration
isn't listed in `applied.txt`. Preserve this check in main branch protection.
It is bookkeeping, not proof that a database has the required objects: VM
activation and mobile publication additionally run the read-only schema contract.
Migrations are immutable once applied; never edit one to match a broken database.
After adding a migration, update/review the disposable PostgreSQL contract using
[the backend procedure](backend/README.md#applying-and-verifying-migrations).

## After a JS-only release
Installed apps update over the air on next launch — no reinstall. The stable APK
download link in the README changes only on a native (runtimeVersion) release.

## Backend and client transition configuration

- Keep the existing Supabase project, auth/email provider and public anon key.
  The backend `/reset-password` page still needs `SUPABASE_ANON_KEY`.
- Keep old Supabase redirect destinations and functioning old pages while issued
  links or supported old clients use them. Add the approved new `/reset-password`
  and `/confirmed` destinations and verify recovery/confirmation on a device.
- Update both EAS environments only after the new public endpoint passes checks.
  Installed apps with a Railway-owned hostname need OTA; our DNS cannot move it.
- Set required application checks after the workflow exists on branch baselines;
  preserve existing migration/review rules. See the VM runbook for exact contexts.
- A release preparation PR does not authorize merging, provisioning, publishing
  mobile updates, deleting Railway or closing the migration issues.
