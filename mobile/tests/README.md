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
- While online, open a concept and let saved lessons download. Restart offline:
  previously viewed lessons and saved lessons should retain full text/examples.
  A lesson never downloaded should show the unavailable state and retry online.
- Open Personalization offline after an online session. Follow/unfollow topics,
  including server-added topics, restart offline, and confirm the choices persist.
- Like/save and change topics offline, then restore connectivity while staying
  on the same screen. The queue should drain automatically (native retry delay
  grows from 5 to at most 30 seconds). Repeat by reopening/foregrounding the app.
  Background timers stop; closed-app OS synchronization is outside this scope.
- Interrupt connectivity during replay and try rapid repeated toggles. The last
  choice should survive, including across a restart. Sign out with pending work
  and confirm the next account sees no old lessons, catalog, or queued actions.
- Try signing in, signing up, and resetting a password offline: show connection
  advice without raw Java/JavaScript diagnostics. Invalid credentials remain clear.
- Check light/dark themes and large text. The offline cloud should float gently,
  remain still with reduced motion, and stop while its screen/app is inactive.

The Node tests cover storage ordering, account cleanup races, cached topics,
latest-intent coalescing, and retry scheduling. End-to-end API replay and native
lifecycle behavior still require the UI checks above; they are not simulated by
the storage unit tests.

## Mocked browser regression

`offline.browser.cjs` exercises the actual exported app with dummy authentication
and intercepted API calls. It uses an existing Playwright installation; set
`PLAYWRIGHT_TEST_MODULE` to its `playwright/test` module if it is outside this
project, and optionally set `PLAYWRIGHT_CHROMIUM_PATH` to a Chromium executable.
No live account or backend is used. From `mobile/`, export and run:

```sh
CI=1 EXPO_NO_DOTENV=1 EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 \
  EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4781/api \
  EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:4781 \
  EXPO_PUBLIC_SUPABASE_ANON_KEY=test-public-key \
  npx expo export --platform web --output-dir /tmp/one-concept-offline
node tests/offline.browser.cjs /tmp/one-concept-offline \
  --no-event --retry-error --signout-inflight
node tests/offline.browser.cjs /tmp/one-concept-offline --midnight
node tests/offline.browser.cjs /tmp/one-concept-offline --partial-connectivity
```

The flags exercise timer-only reconnection, a 503 during replay, and a request
that fails after sign-out. Omit `--no-event` to test the browser online event.
The separate `--midnight` scenario holds a like request across the date change,
queues Save behind it, and verifies persistence through offline restart and replay.
`--partial-connectivity` serves progress but fails topics, checks that requests
back off, and restores topics to verify automatic recovery without a browser event.
The scheduler unit tests check the full 5–30 second delay progression.
For the unchanged pre-fix export, `--baseline` asserts the original #133 failures.
The test uses port 4781 and closes its server/browser afterward. Optional
`OFFLINE_SCREENSHOT_PATH` saves the offline detail view for visual inspection.
