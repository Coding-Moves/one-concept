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
- In sign-in and signup, reveal/hide a typed password with the eye button. The
  value should stay intact, including with the native keyboard and autofill.
  Switching modes or submitting hides it again; the button is disabled during
  requests. Check screen-reader labels, large text, and light/dark themes.
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
  npx expo export --platform web --clear --output-dir /tmp/one-concept-offline
node tests/offline.browser.cjs /tmp/one-concept-offline \
  --no-event --retry-error --signout-inflight
node tests/offline.browser.cjs /tmp/one-concept-offline --flush-race
node tests/offline.browser.cjs /tmp/one-concept-offline --midnight
node tests/offline.browser.cjs /tmp/one-concept-offline --partial-connectivity
node tests/offline.browser.cjs /tmp/one-concept-offline --large-collections --require-compact
node tests/offline.browser.cjs /tmp/one-concept-offline --whats-new
node tests/password.browser.cjs /tmp/one-concept-offline
```

`--clear` ensures a changed app version reaches the export instead of reusing
stale Expo configuration from Metro.

The flags exercise timer-only reconnection, a 503 during replay, and a request
that fails after sign-out. Omit `--no-event` to test the browser online event.
`--flush-race` delays a reconnect reconciliation while a later Save is optimistic, then rejects Unlike while Unsave is pending. It proves unrelated state survives and the pending counter drains. The separate `--midnight` scenario holds a like request across the date change,
queues Save behind it, and verifies persistence through offline restart and replay.
`--partial-connectivity` serves progress but fails topics, checks that requests
back off, and restores topics to verify automatic recovery without a browser event.
The scheduler unit tests check the full 5–30 second delay progression.
`--large-collections` serves 50 recent records from a 365-item account. It checks
full Stats totals, older Saved search/category filters, page failures/retry,
manual retry immediately after connectivity returns,
all 365 saved explanations/examples on disk after an offline restart, unopened
downloaded lessons in the UI, offline completion/unsave, and sign-out
while a page is in flight. `--require-compact` checks state-bearing requests opt
into the compact API contract; it can be added to the other scenarios too.
`COLLECTION_SCREENSHOT_PATH` optionally captures the older-item search result.
For the unchanged pre-fix export, `--baseline` asserts the original #133 failures.
The test uses port 4781 and closes its server/browser afterward. Optional
`OFFLINE_SCREENSHOT_PATH` saves the offline detail view for visual inspection.

`--whats-new` checks the current version's card in light/dark themes at small
phone, standard phone, and landscape sizes. The title and Got it must stay fully
visible, the final highlight must scroll into view, and dismissal must persist
through an offline restart. Set `WHATS_NEW_SCREENSHOT_DIR` to save all six previews.
Use a version with a nonempty What's New entry; the test intentionally fails if
that required release content is missing or the export has a stale version.

`password.browser.cjs` uses the same export, Playwright settings, and port 4781;
run the browser scripts sequentially. It starts signed out and intercepts
authentication with dummy responses. It checks visibility and keyboard control
in both auth modes, unchanged submitted passwords, masked input and disabled
controls during requests, signup confirmation, remasking on mode changes and reload,
and 44px+ targets at 320/390/960px in both themes. Set `PASSWORD_SCREENSHOT_DIR`
to save light/dark previews with empty fields. No real emails or accounts are used.

For #182, full saved-body caching is already implemented on `develop`. Let the
app finish downloading lessons while online before testing offline; a device
cannot read a body it has never downloaded. App upgrades preserve existing
downloads, while explicit sign-out clears account caches. The mocked browser
checks cover web storage and app behavior; native keyboard/autofill and device
storage still require the preview checks above. A production release is needed
to deliver the changes to installations still running the older `main` build.


## Daily review and continued learning (#195)

`reviewProgress.test.mjs` checks review outbox persistence and pending-state
reconciliation without increasing unique learned totals. The actual exported
app can be exercised with `node tests/review.browser.cjs /path/to/web-export`
using the same Playwright environment variables as the other browser scripts.
Use dummy API/Auth configuration pointing to `http://127.0.0.1:4781` (API path
`/api`); no live user or provider is needed. The scenario covers light/dark,
review labelling, future-subject discovery, offline completion/restart,
reconnect, separate Stats totals, and enlarged text at a narrow viewport.

Add `--reject-review` to exercise an expired offline completion (409) followed
by a failed state refresh (503). The UI and disk must restore the uncompleted
review and exact pre-tap totals before and after restart, in both themes.

Physical-device font scaling, screen readers and native storage still require
manual acceptance. Syncing remains foreground/reopen JS work on the current APK.


## Learning experience (#158–#160)

Using the same dummy-config export and Playwright environment above, run these
scripts sequentially (each uses port 4781):

```sh
node tests/history.browser.cjs /path/to/export
node tests/learning-ui.browser.cjs /path/to/export
```

History checks 120 lessons with 50-item pages, retry after 503, search within the
loaded pages, offline page/detail reading after restart, and sign-out during a
page request. Older metadata is requested only when Load older lessons is used;
search explicitly covers loaded history. Lesson bodies must have been opened or
saved online to be available offline.

UI checks manual refresh, disabled controls during a request, retained offline
content, actual banner contrast in both themes, and an enlarged profile at
320px. Native pull gestures, OS Dynamic Type, TalkBack and VoiceOver still need
physical-device acceptance. Refresh buttons provide an accessible alternative.


## Achievement scenarios (#209)

Using the mocked export environment above, run:

```sh
node tests/achievements.browser.cjs /tmp/one-concept-offline
```

Checks cover both themes, grouped celebrations, ordering behind What's New,
earned/locked cards, details and contrast, narrow/enlarged text, offline restart
and a delayed old-account request after signing into a different account. No
real credentials or production services are used. Native TalkBack, system font
scaling and physical Android Back remain manual device checks.
