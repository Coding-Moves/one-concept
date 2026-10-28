# Authentication email redirects after the Supabase cutover

Supabase Auth verifies email links before redirecting the browser to an allowed
HTTPS landing URL. The production mobile release on `main` sends new sign-up and
recovery links to the Netlify browser pages built from
`EXPO_PUBLIC_WEB_BASE_URL`. Those pages remain the current explicit redirect
destinations; their `/confirmed` and `/reset-password` flows are tested in
`admin/tests/public-pages.spec.ts`.

The Supabase `api` Edge function also serves browser pages at:

- `/functions/v1/api/confirmed`: shows a neutral message on direct visits and a
  confirmation message after an Auth redirect. A recovery session sent to this
  page is forwarded to the reset page with its URL fragment.
- `/functions/v1/api/reset-password`: accepts a recovery session in the URL
  fragment, removes it from the address bar, and updates the password through
  Supabase Auth. A missing or expired link displays an error.
- `/functions/v1/api/privacy`: shows the learner privacy policy.

Once configured as the Site URL, the Edge pages provide a fallback for new
links that omit an explicit redirect. They also support the API-based redirect
configuration planned on `develop`. They contain only the
Supabase project URL and publishable key; no service credential is sent to the
browser. Their route and browser behavior are covered in
`supabase/functions/api/handler.test.mjs` and
`admin/tests/auth-landing.spec.ts`.

## Production deployment and verification

1. Deploy the reviewed `api` Edge function revision through the protected
   production deployment workflow. Confirm `/health` and each public page over
   HTTPS. A direct visit to `/confirmed` must ask the visitor to open an email
   link; a direct visit to `/reset-password` must report an invalid link.
2. In the matching Supabase project, allow the exact `/confirmed` and
   `/reset-password` Edge URLs under **Authentication → URL Configuration**.
   Keep the working Netlify redirect URLs while the released mobile app still
   uses them. Do not add a wildcard or a retired host.

   ```text
   https://egdszjoesxlccauahmsx.supabase.co/functions/v1/api/confirmed
   https://egdszjoesxlccauahmsx.supabase.co/functions/v1/api/reset-password
   ```

3. Keep the **Site URL** fallback on a working page. Change it to the Edge
   `/confirmed` page only after that page is deployed and its recovery
   forwarding is verified. The Site URL is used when a client supplies no
   explicit redirect.
4. Check Expo's production `EXPO_PUBLIC_API_BASE_URL`,
   `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_WEB_BASE_URL` against the
   production Supabase project and current Netlify site. The publishable key
   must belong to the same project.
5. With an inbox and account you control, request a fresh signup confirmation
   and password recovery email. Check that confirmation permits sign-in, and
   that recovery accepts a new password and permits sign-in with it. Do not
   share email links, URL fragments, tokens, or passwords in logs or chat.

A `200` response from a landing page proves only that the page is served; it
does not prove that Supabase verified the email or changed the password.
