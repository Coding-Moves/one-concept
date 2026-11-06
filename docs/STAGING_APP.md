# One Concept Staging on the same phone

Issue [#255](https://github.com/Coding-Moves/one-concept/issues/255) tracks the live setup and acceptance. The repository provides a separate **One Concept Staging** Android package (`com.codingmoves.oneconcept.staging`), iOS identifier and scheme, a banner on sign-in and signed-in screens, the `preview` EAS channel, and a staging-only native runtime. Production keeps its existing package and channel. One EAS project hosts both variants. A healthy staging API alone does not prove Auth, push, website, or phone isolation.

## Activate the existing staging project

1. Use the existing Supabase staging project `zhrulokgngjceqgjkcmw`. Check that it is healthy and that the required reviewed migrations are present. Apply missing staging migrations through the protected [staging migration path](SUPABASE_API_STAGING.md); do not copy production data or apply SQL to production for this setup. The public staging `/functions/v1/api/health` returned HTTP 200 with a reachable database on 2026-11-05, but the remaining services still need live checks.
2. In the protected GitHub `supabase-staging` environment, verify that its deployment branch policy includes **`develop`** and that the owner approval rule remains enabled. The existing staging API/worker tag policies can stay. Verify the staging-scoped access token, staging direct database URL, and both project-ref variables. Check the **staging project's Edge secrets** before deployment: `ENVIRONMENT=staging`; keep `GENERATION_ENABLED`, `FUTURE_REFILL_ENABLED`, `EDITORIAL_EMAIL_ENABLED`, and `WORKER_GENERATION_TEST_ENABLED` off by default. Clear any leftover `WORKER_CANARY_*` overrides that could turn these worker gates back on. Keep push test tokens empty except for an explicitly approved test handset. These are project-wide Edge settings, not EAS app variables. Run **Deploy Supabase API and worker to staging** on the current `develop` commit. The workflow verifies the database target and schema before deploying, then checks API health and unsigned worker rejection. It does not change Edge secrets, Cron, or provider switches.
3. Deploy a separate staging browser/review origin and note its **actual** HTTPS origin. Do not reuse the current production Netlify review site or planned production review domain. Build the staging site with `VITE_API_URL` and `VITE_SUPABASE_URL` pointed at this staging project, its own `VITE_SUPABASE_PUBLISHABLE_KEY`, and `VITE_ENVIRONMENT=Staging`. Add only that exact browser origin to staging Edge `ALLOWED_ORIGINS`. Set staging `EDITORIAL_INVITE_REDIRECT_URL` to that origin plus `/auth/callback` and `EDITORIAL_EMAIL_DASHBOARD_URL` to that origin before testing reviewer invitations; keep email delivery disabled until controlled recipient tests. The browser setup is detailed in [the review-site guide](../admin/README.md).
4. In **staging** Supabase Auth URL Configuration, use a staging-only Site URL and allow the mobile email landing URLs `https://zhrulokgngjceqgjkcmw.supabase.co/functions/v1/api/confirmed` and `https://zhrulokgngjceqgjkcmw.supabase.co/functions/v1/api/reset-password`. For reviewer invitations, also allow the actual staging browser origin plus `/auth/callback`. Check that staging email templates contain no production links, then send one test-account confirmation and reset email; do not paste live links or tokens into chat. Production Auth settings stay unchanged.
5. Use only staging test accounts. Confirm sign-in, sign-out, and reset cannot authenticate a production-only account in the staging app. Inspect `cron.job` and `public.edge_worker_jobs` in staging; keep paid generation and external sends disabled by default. In staging Storage, create a private `profile-avatars` bucket if absent, with a 256 KiB limit and `image/jpeg` allowed. The API accepts JPEG/PNG/WebP input but writes normalized JPEG; check one staging photo upload and removal without using production data.

## Configure the EAS preview environment

In the existing Expo project, set the **preview** environment values below. Check the hostname of each URL before saving; the publishable key is public but still belongs to the staging project. Leave the **production** EAS environment untouched.

| Name | Preview value |
| --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | `https://zhrulokgngjceqgjkcmw.supabase.co` |
| `EXPO_PUBLIC_API_BASE_URL` | `https://zhrulokgngjceqgjkcmw.supabase.co/functions/v1/api` |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Staging project's publishable/anon key, obtained in its dashboard |
| `EXPO_PUBLIC_WEB_BASE_URL` | Actual separate staging browser origin, with no path |
| `EXPO_PUBLIC_LEGACY_WEB_BASE_URL` | Empty unless an earlier **staging-only** shared-profile origin must remain valid |

`APP_VARIANT=staging` and `EXPO_PUBLIC_APP_VARIANT=staging` come from the `preview`, `development`, and `staging-development` build profiles and from the preview OTA workflow. The old `development` profile now uses the staging identity too, so it cannot overwrite a production install. Production profiles and OTA use `production`. The release validator rejects cross-project API/Auth URLs and known production review origins in staging. Check any account-wide Expo variables do not override these profile values. `EXPO_PUBLIC_*` values are embedded in the app and must contain no service-role or provider credentials.

Register `com.codingmoves.oneconcept.staging` as a **separate Android client** in Firebase and configure its package-specific FCM/EAS push credentials before testing reminders. In Expo's **preview** environment upload that client's `google-services.json` as a **file** variable named `STAGING_GOOGLE_SERVICES_FILE`. The staging build fails if the file is absent or does not register the staging package. A local copy may be named `mobile/google-services.staging.json` and is gitignored. Do not overwrite the production `mobile/google-services.json` or reuse its production-only client entry. Preview notification tokens must be registered only with staging API accounts.

## Build and install

After the website, Auth, EAS, and Firebase checks pass, run **EAS Build (Android)** on `develop` with profile `preview`. The workflow preflight checks the EAS public values, and the remote build validates the Firebase file. The resulting Expo build page provides the installable staging APK link; record that real link on #255. Its launcher name and in-app banner say **Staging**. Keep the production app installed. For local feature-branch work, build profile `staging-development` instead; it has the same staging package and preview channel plus `expo-dev-client`. Installing that dev client can replace the regular staging APK, but cannot replace the production package.

The added `expo-dev-client` is a native dependency. The next production release needs a **new production APK** and a runtime compatible with this change; its marketing version and What's New card belong in the separate `develop` → `main` release PR. Existing production installs stay on their current runtime until that release/install. The staging runtime is distinct even from old preview builds made with the production package, so those old builds cannot receive staging OTA updates. While activation is deferred, leave the optional Release staging deployment ID blank so preview OTA is skipped; do not use production values as a substitute.

## Test an open PR from your PC

Use a staging test account and an uncommitted, gitignored `mobile/.env.local`. Do not use production credentials, DB backups, or a production service-role key.

```bash
# On the PC: find its Wi-Fi/LAN IPv4 address; phone and PC need the same network.
hostname -I
# Start the backend with safe local/staging test configuration (never production).
cd backend
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
# In another terminal, from mobile/ with the staging development build installed:
APP_VARIANT=staging EXPO_PUBLIC_APP_VARIANT=staging npx expo start --dev-client --lan
```

Set `EXPO_PUBLIC_API_BASE_URL=http://<PC-LAN-IP>:8000` in `mobile/.env.local`; keep `EXPO_PUBLIC_SUPABASE_URL` and its publishable key on the staging project, and use the actual staging browser origin. The phone cannot use `localhost` for the PC. Allow inbound ports 8000 and 8081 on the PC firewall for the LAN, open the Metro QR/deep link in **One Concept Staging**, and test the exact PR flow. Run `npm run typecheck`, `npm test`, and relevant backend tests before proposing the PR. Stop Metro and the local API afterward. Reinstall the regular staging APK if you want to return to normal preview OTA behavior.

After staging activation and a feature PR merge into `develop`, apply any reviewed staging migrations and run the protected staging Edge deployment. Then manually run **EAS Update (OTA)** on the same `develop` commit with that successful staging deploy run ID. It verifies the matching deployment before publishing to the `preview` channel. Verify the integrated staging flow before using preview OTA in a production release. Until activation, the production Release workflow skips its optional preview job. Do not publish a feature-branch OTA or use a PC address in an EAS release build.

## Acceptance and rollback

- On one phone, open production and staging side by side. Production stays signed in to production; staging accepts only a staging test account. Verify staging sign-out, account switching, offline queue, reset links, and notifications do not affect production.
- Confirm a preview OTA reaches only the staging runtime and a production OTA reaches only the production runtime. Record the build IDs, runtime versions, and results on #255 before closing it.
- If staging is misconfigured, stop preview OTA/build distribution, close staging Cron/provider gates, fix the preview EAS values, rebuild or republish preview, and reinstall only the staging package. Do not change production EAS values or delete production data.

No staging APK, Firebase registration, browser origin, email delivery, or same-phone result is claimed by this repository change. Keep #255 open until those live checks pass.
