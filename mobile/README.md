# One Concept mobile app

The Expo/React Native client signs users in through Supabase Auth and reads or
writes learning data through the FastAPI API. It never connects to Postgres or
Gemini directly.

For Expo SDK behavior and APIs, use the exact
[SDK 57 documentation](https://docs.expo.dev/versions/v57.0.0/). Deployment,
EAS builds, and over-the-air updates are covered separately in
[DEPLOYMENT.md](DEPLOYMENT.md).

## Run locally

1. Start the backend and make it reachable from the device or simulator. Follow
   [the backend setup](../backend/README.md#running-locally) first.
2. Create local public configuration. These values are compiled into the app, so
   they must never contain a database password, service-role key, or Gemini key.

   ```bash
   cd mobile
   cp .env.example .env
   ```

   Set `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_SUPABASE_URL`, and
   `EXPO_PUBLIC_SUPABASE_ANON_KEY` in `.env`. For a physical phone, the API URL
   must use the computer's LAN address rather than `localhost`; the phone and
   computer must be able to reach each other.
3. Install the locked dependencies and start Expo:

   ```bash
   npm ci
   npx expo start
   ```

   Use Expo's interactive controls to open Android, iOS, or web. If configuration
   is missing or malformed, the app shows its setup state instead of treating the
   problem as an offline connection.

## Useful commands

```bash
npm run typecheck   # TypeScript
npm test            # Node regression suite
npm run android     # open the Android target through Expo
npm run ios         # open the iOS target through Expo
npm run web         # open the web target through Expo
```

The Node tests cover pure services, persisted account data, authentication and
sync races. Some exported-app browser scenarios in [tests/README.md](tests/README.md)
need a local Playwright installation; they never need a real account or backend.

## Application map

| Area | Main files | Responsibility |
| --- | --- | --- |
| Startup and navigation | `App.tsx`, `src/navigation.ts` | Provider composition, font/splash handling, authenticated tabs, modal screens, recovery UI, What's New. |
| Authentication | `src/context/AuthContext.tsx`, `src/lib/supabase.ts` | Supabase session lifecycle, sign-in/up/recovery, token supply, account cleanup. |
| Learning state | `src/context/ProgressContext.tsx`, `src/services/progressRepository.ts` | Cached-first state, optimistic actions, server reconciliation, local demo fallback. |
| API and availability | `src/api/`, `src/context/ConnectivityContext.tsx` | Authenticated HTTP, safe error shapes, request timeout, connectivity inferred from requests. |
| Offline sync | `src/services/mutationOutbox.ts`, `mutationQueue.ts`, `remoteProgressRepository.ts`, `syncLoop.ts` | Durable latest-intent queue, replay, bounded retry and account-safe cleanup. |
| Screens and shared UI | `src/screens/`, `src/components/`, `src/theme/` | Learner-facing views, accessibility, light/dark themes, reusable presentation. |
| Cached content | `src/services/conceptApi.ts`, `offlineCache.ts`, `savedApi.ts`, `historyApi.ts` | Account-scoped lesson, Saved, and History data for offline reading. |

The broader cross-service design is in [../docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md)
and [../docs/CODEBASE_MAP.md](../docs/CODEBASE_MAP.md).

## Offline and account rules

- Cached content is shown first, then refreshed when the API is reachable.
  Uncached content remains unavailable offline; the app never invents a lesson
  or account totals for an authenticated user.
- Learner changes such as likes, saves, topic follows, reviews, and today's
  completion are recorded as durable intent when a retryable request fails.
  The queue keeps only the latest intent for each target.
- Replay runs while the app is open or reopened. It uses bounded backoff and
  pauses an item after repeated server failures until the learner explicitly
  retries it. The current APK has no closed-app background sync worker.
- Sign-out clears account-scoped caches and queued work. Request and storage
  epochs prevent a late response from one account appearing in the next account.
