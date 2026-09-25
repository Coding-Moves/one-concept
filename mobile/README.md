# One Concept mobile

Expo SDK 57, React Native 0.86, React 19 and TypeScript. Supabase handles login;
the FastAPI backend owns lessons, progress, reminders and achievements. The app
caches downloaded lessons and pending actions for offline use.

## Local setup

Use Node 24 and read the [exact SDK documentation](https://docs.expo.dev/versions/v57.0.0/).
From a clone of this repository:

```sh
cd mobile
npm ci
cp .env.example .env
# Fill the three public values with your DEVELOPMENT backend/Supabase project.
node --env-file=.env scripts/validate-public-config.cjs
npm start
```

Expo loads `.env` for the app; the validation command above explicitly loads
that same file. `npm run validate:config` checks exported process variables,
which is useful with `eas env:exec` for a configured EAS environment. Do not put service
role, database, Gemini or SMTP credentials in any `EXPO_PUBLIC_*` value.

- `EXPO_PUBLIC_API_BASE_URL`: the API origin; local web can use localhost. A
  physical phone must use a reachable development LAN address, not the phone's
  own `localhost`. Start the development API on `0.0.0.0` if needed.
- `EXPO_PUBLIC_SUPABASE_URL`: development Supabase project URL.
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`: that project's public anon key.

Missing or malformed configuration displays a setup error before auth/progress
mounts. It cannot silently enqueue a request as though the internet were down.
Production/preview validation requires HTTPS and rejects loopback endpoints.
EAS Build runs the same validator; OTA workflows validate before publication.

`npm run web` opens the web app. Push notifications and native lifecycle behavior
need a real development/installed build and a physical device; a browser test
cannot establish actual notification delivery. See [deployment](DEPLOYMENT.md)
for the existing EAS project and build profiles; do not reinitialize that project.

## Code map

| Area | Main files |
| --- | --- |
| Navigation and providers | `App.tsx`, `src/context/` |
| Auth and account replacement | `AuthContext.tsx`, `services/accountCaches.ts` |
| API validation, timeout and account fencing | `src/api/` and `public-config.cjs` |
| Progress and optimistic state | `ProgressContext.tsx`, `remoteProgressRepository.ts` |
| Durable pending actions | `mutationOutbox.ts`, `mutationQueue.ts`, `syncLoop.ts` |
| Reading and collections | Today, History and Saved screens; downloaded concept cache |
| Achievements | `AchievementsContext.tsx`, `achievementStore.ts`, Profile collection |
| Release version and one-time card | `app.config.js`, `src/data/whatsNew.ts` |

Offline intent survives app restart. Reconnect and user writes share the existing
serialized state path so an old snapshot cannot erase a newer tap. Server
failures use persisted backoff; eight failures pause replay and show **Retry
saved changes**. `Retry-After` may extend the delay. Account changes remove old
state and fence late responses. Retries run while the app is active, not as an
OS background job. Push reminders are scheduled on the backend.

## Validation

```sh
npm run typecheck
npm test
```

Unit tests use Node 24's built-in runner and need no real account/provider keys.
For the real exported app's mocked browser flows, follow
[tests/README.md](tests/README.md), including replay, midnight, account changes
and achievement checks. Run its browser scripts sequentially because they use
the same local port. Native accessibility, background/foreground transitions,
notification permission and real push delivery remain device checks.

[The codebase map](../docs/CODEBASE_MAP.md) covers every layer;
[the VM runbook](../docs/VM_DEPLOYMENT.md) covers the deferred hosting migration.
