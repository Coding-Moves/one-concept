# First-party review domain rollout (#480)

The single owner/reviewer website stays on its existing Netlify site. Its
intended production origin is `https://review.oneconcept.codingmoves.com`.
The existing `coding-moves-one-concept-review.netlify.app` host remains live
through the transition so issued links keep working. Do not configure staging
Auth, API, or invitations to use either production review origin.

## Order of operations

1. In the **existing production Netlify site**, add
   `review.oneconcept.codingmoves.com` as a custom domain. Read Netlify's exact
   DNS target from Domain management. At the DNS provider for `codingmoves.com`,
   add only the required `review.oneconcept` record; do not change root or mail
   records. Wait until Netlify reports the domain verified with valid HTTPS.
2. Confirm the new origin serves `/`, `/about.html`, `/privacy.html`,
   `/one-concept-icon.png`, `/account`, and a direct `/auth/callback` load.
   About and Privacy must open without signing in. Keep the old host available;
   a browser redirect is optional only after its path, query, and recovery-link
   behavior has been checked. Never redirect old links by dropping their query
   or fragment.
3. In Google Search Console, verify the **Domain property** `codingmoves.com`
   by adding Google's supplied DNS TXT record. Use a Google account that is an
   Owner or Editor of the relevant Google Cloud project, or grant that project
   account ownership of the verified property. Keep the TXT record afterward.
   In Google Cloud OAuth Branding, use the public
   `https://review.oneconcept.codingmoves.com/about.html` homepage and
   `https://review.oneconcept.codingmoves.com/privacy.html` policy, and add
   `codingmoves.com` as an authorized domain if requested. The Gmail sender
   uses an existing `gmail.send` refresh token. Its OAuth client callback is
   **not** the Supabase `/auth/callback`; inspect the registered client before
   changing any JavaScript origin or redirect URI. Domain ownership alone does
   not approve sensitive-scope OAuth verification.
4. Deploy the reviewed site and Edge API code. In **production** Supabase Auth
   URL Configuration, allow these exact additional redirects:

   ```text
   https://review.oneconcept.codingmoves.com/account/callback
   https://review.oneconcept.codingmoves.com/auth/callback
   ```

   Retain the old Netlify callbacks and the working mobile confirmation/reset
   redirects until outstanding links expire. Keep the current Site URL on the
   verified learner confirmation fallback; do not change it to the review site.
5. Only after HTTPS and Auth allowlisting pass, set these production Edge
   secrets/configuration values (exact origins, no final slash):

   | Setting | Value |
   | --- | --- |
   | `PUBLIC_SITE_URL` | `https://review.oneconcept.codingmoves.com` |
   | `EDITORIAL_INVITE_REDIRECT_URL` | `https://review.oneconcept.codingmoves.com/auth/callback` |
   | `EDITORIAL_EMAIL_DASHBOARD_URL` | `https://review.oneconcept.codingmoves.com` |
   | `ALLOWED_ORIGINS` | Append `https://review.oneconcept.codingmoves.com` while keeping the old live origin. |

   The Edge API falls back to the old host when `PUBLIC_SITE_URL` is unset, so
   deploying this code before the DNS cutover preserves confirmation, recovery,
   and privacy redirects. Configure the worker's dashboard URL and origins as
   needed for editorial email; do not enable a sender merely by changing URLs.
6. Install the repository's updated Supabase Auth templates only after the
   new public icon loads. Update production EAS
   `EXPO_PUBLIC_WEB_BASE_URL` to the new origin for the next compatible app
   release. This is a public URL, not a key. The staging EAS values remain
   isolated. The production Release workflow's staging prerequisite is tracked
   in #255 and must be resolved before that release if staging stays deferred.

## Live acceptance

Using controlled accounts and inboxes, verify signup confirmation, password
recovery, and a new reviewer invitation all reach the intended pages without
raw tokens in the address bar after the callback completes. Test an existing
reviewer sign-in, assignment email dashboard link, account page, sign-out,
expired link, and old Netlify-hosted links. Confirm the Gmail sender still
authorizes and an intended reviewer email reaches its inbox; a successful API
request alone does not prove delivery. Check the Google Cloud Branding status
and any separate scope-verification result rather than assuming approval.

Rollback is to restore the previous Edge URL settings and email templates while
keeping the old Netlify host and Auth redirects active. Do not remove the custom
domain or DNS record as a first rollback step, and do not change learner data or
review decisions. Record the live DNS target, deployed revision, effective URL
settings, OAuth status, and controlled test results on #480 without posting
credentials, email tokens, or private account data.
