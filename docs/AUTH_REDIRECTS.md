# Authentication email redirects

Supabase verifies email addresses itself. After verification, it redirects the
browser to a permitted HTTPS URL. One Concept uses its FastAPI public pages for
that final browser step:

- `GET /confirmed` displays the One Concept confirmation page and asks the
  person to return to the app.
- `GET /reset-password` displays the One Concept password-reset form.

These pages are product pages served by the API. Railway is only the current
hosting provider; its name, error page, or dashboard must never be part of the
learner experience.

The mobile app supplies `emailRedirectTo` for new sign-ups and `redirectTo` for
password recovery from `EXPO_PUBLIC_API_BASE_URL`. This keeps both flows on the
same deployed API origin instead of relying only on a stale Supabase Site URL.
Supabase must allow those destinations before it will honor them.

## Owner checklist

Do these **before merging the PR**. They are safe while the PR is open and do
not require a mobile build, database migration, secret, or payment.

1. In Railway, open the production **api** service, then **Settings →
   Networking**. Copy the active public HTTPS domain exactly. Do not copy a
   deployment ID, internal service URL, or an old removed domain.
2. In a private browser window, open `https://YOUR-API-DOMAIN/confirmed`.
   Continue only when it displays the One Concept **“Email confirmed”** page.
   If Railway shows “The train has not arrived at the station”, wait for the
   deployment/domain to become active or create and attach a new Railway domain
   to the current api service. Do not place that broken address in Supabase.
3. Open Supabase **Authentication → URL Configuration** for the production
   project. Set **Site URL** to `https://YOUR-API-DOMAIN`. This remains the
   fallback for old app versions and any request that lacks a redirect value.
4. Under **Redirect URLs**, add these exact entries:

   ```text
   https://YOUR-API-DOMAIN/confirmed
   https://YOUR-API-DOMAIN/reset-password
   ```

   Keep any still-working previous recovery URL until links already sent to
   users have expired. Do not add wildcards, credentials, a Railway dashboard
   URL, `localhost`, or a URL with a query string.
5. In Expo/EAS, inspect the **production** value of
   `EXPO_PUBLIC_API_BASE_URL`. It must equal `https://YOUR-API-DOMAIN` with no
   trailing path, query, fragment, username, or password. The value is public
   configuration; never put Supabase service keys or database passwords there.
6. Save the dashboard settings and capture the exact domain in the release
   record. No source-code configuration file should contain the live domain if
   EAS already owns that public setting.

## After this PR merges to `develop`

1. Wait for the normal preview EAS update workflow to complete, then install or
   open the staging/preview app. A merge to `develop` does **not** update the
   production app.
2. Create a fresh test account with an inbox you control. Open the confirmation
   email and check this sequence:

   ```text
   Supabase verifies the address → One Concept confirmation page → sign in succeeds
   ```

   The browser must not show a Railway 404 page. Test password recovery too;
   it must open the One Concept reset-password page and permit sign-in with the
   new password.
3. If the test fails, keep the PR merged but stop the production release. Check
   the exact generated email URL, the Railway domain and the Supabase allowlist
   rather than changing templates or exposing a credential.

## Before production users receive the fix

This is a JavaScript mobile change. After the preview test passes, include it in
a normal `develop` → `main` release PR. After that release PR is merged, verify
the deployed API health and manually run the repository’s **Release** workflow
on the verified `main` commit. That publishes the production EAS OTA update to
compatible installed builds. A production user receives it on a later app
launch; an update is not instantaneous.

Changing the Supabase Site URL in the checklist is still worthwhile before the
OTA: it repairs the fallback redirect used by older app versions. Do not claim
production confirmation is fixed until a new controlled account has completed
the real email flow.

## Future own-domain upgrade

When One Concept has a domain, point a subdomain such as
`app.oneconcept.example` at the API service, wait for HTTPS provisioning, then
repeat the checklist using that domain. A true browser-to-app open button later
requires Android App Links (and iOS Universal Links) hosted on that domain. It
is separate from email verification and should be introduced with its own
native release, association-file validation, and device testing.
