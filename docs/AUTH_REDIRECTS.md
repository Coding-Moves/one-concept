# Authentication email redirects after the Supabase cutover

Supabase Auth verifies email links, then sends the browser to a permitted HTTPS
landing URL. Once the pending public-page release is deployed, the Supabase
`api` Edge function serves three pages:

- `/functions/v1/api/confirmed` explains successful email confirmation. If an
  older client sends a recovery session to the Site URL, this page forwards the
  URL fragment to the reset page without sending it to the server.
- `/functions/v1/api/reset-password` accepts a recovery session in the URL
  fragment and updates the password directly through Supabase Auth. It removes
  the token from the address bar as soon as the page loads.
- `/functions/v1/api/privacy` is the learner privacy policy.

The mobile app derives its explicit signup and recovery redirect URLs from
`EXPO_PUBLIC_API_BASE_URL`. Its production value must be the matching
`https://PROJECT.supabase.co/functions/v1/api` address. The Edge routes are
public browser pages; private application routes still authenticate the user.

## Production configuration

1. Deploy the tested Edge `api` function revision containing these pages.
   Check `/health`, `/confirmed`, `/reset-password` and `/privacy` over HTTPS.
   A direct visit to the reset page without a recovery session should show an
   invalid-link message, not a blank page or JSON 404.
2. In the matching Supabase project, open **Authentication → URL Configuration**.
   Allow these exact redirect URLs, with no wildcard or trailing slash:

   ```text
   https://PROJECT.supabase.co/functions/v1/api/confirmed
   https://PROJECT.supabase.co/functions/v1/api/reset-password
   ```

3. After the pages are live, set the **Site URL** fallback to the exact
   `/functions/v1/api/confirmed` page. Its recovery forwarding handles older
   clients that omitted an explicit reset redirect. Keep previous working
   redirect URLs until outstanding email links expire; a retired host
   cannot be repaired by an allowlist entry.
4. Check Expo's **production** `EXPO_PUBLIC_API_BASE_URL` points to the same
   Supabase `api` function, and keep the Supabase Auth URL and publishable key
   matched to that project. Never put a service-role key in mobile or a page.

## Real-device verification

With an inbox and account you control, request a fresh signup confirmation and
a fresh password recovery email. Confirm that the first link opens the One
Concept confirmation page and allows sign-in. Confirm that the second opens
the One Concept reset form, accepts a new password, and allows sign-in with it.
Do not share email links, URL fragments, tokens, or passwords in logs, screenshots
or chat. A 200 response from the page alone does not prove the full Auth flow.

The production app must receive the compatible JavaScript update for its About
screen to link to the Edge privacy page under the API path. Older builds can
still contain retired host URLs; ask those users to update the app rather
than restoring the retired service.
