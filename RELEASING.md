# Releasing One Concept

Production release flow. Keep it boring and repeatable.

## Branch model
- `develop` is the default branch; the **team's** feature/fix PRs target it.
  (This is our internal flow — the project doesn't take outside PRs; see
  [CONTRIBUTING.md](CONTRIBUTING.md).)
- `main` is production. A release is a single PR **develop → main** (no `release/*` branch).
- After merging to `main`, dispatch the protected
  `.github/workflows/supabase-production-deploy.yml` workflow for that exact
  commit. Mobile publication is a separate manual run of
  `.github/workflows/release.yml` after verification.

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
5. After the merge, dispatch **Deploy Supabase API and worker to production** on
   the exact current `main` commit and approve its `production-schema` gate.
   It verifies the actual schema, deploys both Edge Functions, checks that the
   worker rejects unsigned calls, and checks API `/health`. Keep generation
   gates unchanged during deployment, then verify the release-specific API,
   scheduled-job, and client smoke checks. A merge alone does not deploy them.
6. If this release changes `runtimeVersion`, build a compatible **preview APK**
   from the exact new `main` commit before starting Release:
   `cd mobile && eas build --platform android --profile preview --non-interactive --wait`.
   Install it on a spare device; the preview and production APKs use the same
   Android application ID, so they cannot coexist on one device. This build is
   what lets the owner test the preview OTA at the second approval gate. Keep
   the production APK on the regular device until that gate is approved.
7. Open **GitHub Actions → Release → Run workflow**, select **main**, and enter
   the full 40-character main commit SHA in `backend_revision` and the successful
   protected deployment Actions run ID in `production_deploy_run_id`. The
   workflow checks that the deployment ran from that exact current `main` SHA,
   rejects an existing version tag before publishing, and verifies the actual
   schema. It publishes preview OTA first, then waits at a second
   `production-schema` approval. Test the compatible preview build on a real
   device and confirm the effective production API/Auth configuration before
   approving that gate.
8. After the second approval, the workflow rechecks current `main`, publishes
   production OTA, creates the version tag/GitHub Release, and dispatches the
   native-gated APK build. A changed native `runtimeVersion` requires a new APK;
   existing older-runtime installations cannot receive the new runtime's OTA.
   Do not merge another release while publication is running. The standalone
   EAS Update workflow publishes preview only; production uses this release path.

## Database migrations — MANUAL, every release
The deploy does **not** auto-migrate. Files in `backend/migrations/*.sql` must be run
by hand against the production Supabase DB before deploying code that uses them.

For each migration not yet applied to prod:
1. Run it — Supabase → **SQL Editor** (paste the file), or
   `psql "$DIRECT_URL" -f backend/migrations/<file>` (`DIRECT_URL` = the 5432 session pooler).
2. Verify the resulting production objects and behavior. Only then add its
   filename to **`backend/migrations/applied.txt`** on `develop`. Keep already
   applied SQL immutable. The protected actual-schema check remains required.

`.github/workflows/migrations.yml` fails on `main` and on release PRs if any migration
isn't listed in `applied.txt`. That required filename check proves only that the
operator recorded it. The protected production Edge deployment and Release
schema jobs inspect actual database objects; follow
[SCHEMA_VERIFICATION.md](docs/SCHEMA_VERIFICATION.md) to configure those gates.
The Release workflow requires the protected check before publishing. Migrations
are immutable once applied — never edit an applied file; add a new one.

## After a JS-only release
Installed apps update over the air on next launch — no reinstall. The stable APK
download link in the README changes only on a native (runtimeVersion) release.

## Auth redirect configuration

The Edge API needs its public Supabase publishable/anon key to render the
password-reset page. In production Supabase Auth, allow the exact
`/functions/v1/api/confirmed` and `/functions/v1/api/reset-password` URLs on
the production project origin. Verify both pages are deployed before using
them as email redirect or Site URLs. See [AUTH_REDIRECTS.md](docs/AUTH_REDIRECTS.md).

## API-only operational updates

The mobile API address comes from EAS `EXPO_PUBLIC_API_BASE_URL`; changing an
Edge Function or repository file alone does not update already-published mobile
bundles. Confirm the target URL and redirect allowlist in each environment.

An endpoint-only operational update reuses the existing release's source and
native runtime. It does not create another version tag or a new release PR.
For a normal version release, all version/What's New requirements above still
apply. Do not rerun `release.yml` for an already-published version to repoint its
API: OTA publication runs before that workflow rejects a duplicate version tag,
so the run can partially publish and then fail.

After protected API/worker deployment, recovery configuration and candidate
testing, obtain the owner's approval of a specific production endpoint change.
Use a clean checkout of the verified current `main` revision, install its locked
dependencies, and verify `EXPO_PUBLIC_API_BASE_URL` in each EAS environment. Check
the effective runtime and app version before export; do not use a feature branch
or bump native runtime merely to move the API. Recheck remote `main` immediately
before publication and stop if it differs from the verified checkout/deployment.

Publish the candidate with the preview environment first, using a compatible
preview installation for validation. Once approved, the explicit EAS commands
from that checkout's `mobile/` directory are:

```sh
eas update --channel preview --environment preview --message "Verify API endpoint" --non-interactive
# Only after candidate validation and approval of the production switch:
eas update --channel production --environment production --message "Update API endpoint" --non-interactive
```

Record the source SHA, environment URL, runtime, update group, channel and device
results in the release record. Do not imply all users have updated when an upload
succeeds. Account for older runtimes, offline clients, fresh installs, recovery
links and rollback. Environment-variable rollback alone does not change
already-published bundles.
