# First-party review domain rollout (#480)

The single owner/reviewer website uses one production Netlify site owned by
the `contactmuawia@gmail.com` account. Its production origin is
`https://review.oneconcept.codingmoves.com`.
The hostname, HTTPS, Google branding, Supabase Auth redirect allowlist, and
Edge CORS origin are live as of November 6, 2026. The Edge destination URLs,
dashboard email templates, mobile public URL, and controlled email-flow tests
remain pending. See [the current work log](WORK_LOG.md) for exact status.
Keep the existing `coding-moves-one-concept-review.netlify.app` hostname and
old Auth redirects available for previously issued links until live flows pass.
Do not configure staging Auth, API, or invitations to use either production
review origin.

## Order of operations

1. Recreate the review site under the owner's `contactmuawia@gmail.com`
   Netlify team after the old account releases the desired
   `coding-moves-one-concept-review.netlify.app` name. Import
   `Coding-Moves/one-concept` from `main` with base directory `admin`, build
   command `npm run build`, and publish directory `dist`. Copy only the four
   production public build variables listed in `admin/README.md`, verifying the
   production Supabase project ref and never putting private keys in `VITE_`
   values. Publish and check the default Netlify hostname after the old
   project releases it. If the hostname cannot be reused yet, keep a temporary
   site name and update redirects only after the final name works.
2. Add `review.oneconcept.codingmoves.com` to that new production site. The
   parent `codingmoves.com` is already attached to this Netlify team, and its
   authoritative DNS is Cloudflare. Read Netlify's exact DNS target from Domain
   management, then add only the required `review.oneconcept` CNAME in
   Cloudflare; do not change root or mail records. Wait until Netlify reports
   the domain verified with valid HTTPS.
3. Confirm the new origin serves `/`, `/about.html`, `/privacy.html`,
   `/one-concept-icon.png`, `/account`, and a direct `/auth/callback` load.
   About and Privacy must open without signing in. Keep the old host available;
   a browser redirect is optional only after its path, query, and recovery-link
   behavior has been checked. Never redirect old links by dropping their query
   or fragment.
4. In Google Search Console, verify the **Domain property** `codingmoves.com`
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
5. Deploy the reviewed site and Edge API code. In **production** Supabase Auth
   URL Configuration, allow these exact additional redirects:

   ```text
   https://review.oneconcept.codingmoves.com/account/callback
   https://review.oneconcept.codingmoves.com/auth/callback
   ```

   Retain the old Netlify callbacks and the working mobile confirmation/reset
   redirects until outstanding links expire. Keep the current Site URL on the
   verified learner confirmation fallback; do not change it to the review site.
6. Only after HTTPS and Auth allowlisting pass, set these production Edge
   secrets/configuration values (exact origins, no final slash):

   | Setting | Value |
   | --- | --- |
   | `PUBLIC_SITE_URL` | `https://review.oneconcept.codingmoves.com` |
   | `EDITORIAL_INVITE_REDIRECT_URL` | `https://review.oneconcept.codingmoves.com/auth/callback` |
   | `EDITORIAL_EMAIL_DASHBOARD_URL` | `https://review.oneconcept.codingmoves.com` |
   | `ALLOWED_ORIGINS` | Append `https://review.oneconcept.codingmoves.com` while keeping the old live origin. |

   The Edge API now defaults to the verified first-party host when
   `PUBLIC_SITE_URL` is unset. Set this value explicitly for staging or any
   alternate deployment. Keep old Auth redirect allowlist entries while issued
   links remain valid. Configure the worker's dashboard URL and origins as
   needed for editorial email; do not enable a sender merely by changing URLs.
7. Install the repository's updated Supabase Auth templates only after the
   new public icon loads. Update production EAS
   `EXPO_PUBLIC_WEB_BASE_URL` to the new origin for the next compatible app
   release. This is a public URL, not a key. The staging EAS values remain
   isolated. The production Release workflow's staging prerequisite is tracked
   in #255; while staging remains deferred, Release skips preview and retains
   its two protected production gates.

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
