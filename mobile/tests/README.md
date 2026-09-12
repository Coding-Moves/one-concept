# Mobile regression checks

Use Node 24, then run `npm ci`, `npm test`, and `npm run typecheck` in `mobile/`.
Tests use Node's built-in runner and TypeScript stripping; no native test
dependency or credentials are needed. A module-type warning is harmless because
the Expo configuration remains CommonJS.

For UI checks, use a test account and exercise these flows on preview:

- Open offline with a saved session whose access token needs refreshing. Cached
  content should open without sign-in; reconnect should permit token refresh.
- Explicitly sign out, then reopen: the previous account's content must be gone.
- Open without cached app data while offline: Today, History, Saved, Stats, and
  Personalization should explain unavailable content. Try again after reconnecting.
- Open a history/saved concept unavailable offline, then retry online in place.
- Try signing in, signing up, and resetting a password offline: show connection
  advice without raw Java/JavaScript diagnostics. Invalid credentials remain clear.
- Check light/dark themes and large text. The offline cloud should float gently,
  remain still with reduced motion, and stop while its screen/app is inactive.

These targeted tests do not cover the separate mutation-queue work in issue #157.
