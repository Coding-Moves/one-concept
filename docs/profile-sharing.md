# Learner profiles and optional sharing

Profile keeps email/password sign-in unchanged. Learners edit a preferred name
through the authenticated API; the confirmed response updates cached progress,
Profile and greetings. Names are trimmed, NFC-normalized, limited to 60 Unicode
code points, and reject empty or control-character input. Failed saves preserve
the input and never enter the offline learning outbox.

## Privacy and links

Sharing starts disabled, with every field hidden. Profile → Public profile &
sharing lets a learner select their current display name, current/longest streak,
unique learned-concept count and individual earned achievements. The name choice
shows the exact name to be shared, including any existing email-derived nickname.
The email field itself is never part of a public response.

The API creates a random 256-bit token independent of account identifiers.
`GET /p/{token}` renders the browser page; `GET /v1/public-profiles/{token}` serves
only the selected public fields. Each read checks current privacy settings and
returns no-store/noindex headers. Public rendering escapes names and achievement
text and includes no third-party assets. There is no user directory or token list.

Authenticated `GET/PUT /v1/me/profile-sharing` reads/saves the caller's settings.
Writes take a row lock and require the current `version`; stale writes receive
409 so another device cannot silently restore older privacy settings. Only earned
achievement codes are accepted. Disabling sharing rotates the token: old links
remain unavailable even after sharing is enabled again. Already-viewed screenshots
or copies cannot be recalled.

The native Share sheet receives only the public HTTPS URL. QR generation uses a
local pure-JavaScript library; no profile data or QR request goes to another
service. Returning from background clears the displayed QR, and incoming profile
views reload public data. Visitors do not send authentication tokens or persist
public profile data in offline caches.

## Timezone and reminders

Migration 0029 preserves every existing account's timezone. A new profile may
initialize its timezone once from its phone. Subsequent automatic syncs cannot
overwrite it, including a deliberate UTC preference. An explicit authenticated
`PATCH /v1/me` timezone change remains supported and PostgreSQL validates the zone.
The app displays the server timezone; this work does not add a timezone picker.
Older app versions do not send the initialize-only flag, so their legacy timezone
sync behavior remains until updated.

Reminder controls report failed preference saves, denied device permission,
unsupported devices and registration failures. A retry control re-registers the
device without toggling the account preference. New registration requests are
bound to the initiating account.

## Deploy in this order

1. Apply `backend/migrations/0028_public_profiles.sql`, then
   `backend/migrations/0029_profile_timezone.sql` to staging. Use the established
   reviewed migration workflow. Neither is recorded as production-applied here.
2. Deploy this backend revision and run its read-only schema verification. Confirm
   `/health` and the public/private smoke checks below. The strict schema gate
   expects both new migrations before this backend starts serving.
3. Publish a preview mobile update against the staging API and complete phone
   checks. Then use the normal production migration/backend/mobile release flow.
   Do not publish mobile sharing before the matching API is deployed.
4. No new secret, paid service, custom hostname, native module or runtime-version
   change is required for browser sharing and QR. The API hostname hosts the page.

The app handles `com.codingmoves.oneconcept://p/{token}`, the Android package's
existing Expo default scheme. Test it on the installed APK before relying on it.
HTTPS links reliably open the public browser page; its Open in One Concept button
can open an installed compatible app. Automatic verified HTTPS App Links require a
stable domain, Android association file/signing fingerprints and native manifest
configuration in a future native build. This PR does not claim those external
associations are configured. iOS association and device behavior are unverified.

## Acceptance checks

Automated: backend profile validation/account ownership, sharing defaults,
allowlist, earned-only awards, anonymous reads, XSS escaping, token revocation and
rotation, stale/concurrent writes, RLS denial and schema-policy drift. Mobile tests
cover Unicode validation, link parsing, QR URL safety, anonymous no-store requests
and late account responses. `mobile/tests/profile.browser.cjs` exercises both
light/dark 320px screens with mocked accounts: invalid/failed/duplicate name saves,
confirmed header refresh, reminder failure/device feedback, field opt-in, QR,
privacy conflict recovery and disable.

Before production publication, use two staging accounts on a physical Android
phone:

- Edit a name, verify Profile and Today's greeting, restart offline and verify
  the confirmed name remains. A failed save must retain typed text without success.
- Change accounts while a save/load is delayed; the old result must not appear in
  the new account. Sign out and check account-cache cleanup.
- With large system text and TalkBack, navigate edit/sharing/preferences, inspect
  switch labels and saving feedback, and reach every control in both themes.
- Enable only one field, inspect the share-sheet payload, scan the QR with another
  device, and view the link signed out. Check both cold and warm app deep links.
- Disable sharing; revisit the old URL/QR and require 404/unavailable. Re-enable
  and verify the old URL stays revoked. Toggle individual fields and revisit.
- Deny notification permission, then allow it in phone settings and retry device
  registration. Confirm the server's configured reminder schedule still applies.

Browser automation cannot certify native Share, a camera scan, installed scheme
registration, Android permission dialogs or TalkBack. Those are release checks,
not claimed as completed in this workspace.
