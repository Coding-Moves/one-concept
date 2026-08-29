# Deployment — EAS Build + EAS Update

The mobile app builds on Expo Application Services and ships JavaScript/UI
changes over the air. Native changes require a new APK/AAB; everything else
reaches installed phones without a reinstall.

## How the pieces fit

- **Channels** — every build is pinned to a channel (`development`, `preview`,
  `production` in [eas.json](eas.json)). `eas update --channel X` publishes only
  to builds from channel X, so production phones never receive preview code.
- **Runtime version** — `runtimeVersion.policy: "appVersion"` in
  [app.json](app.json). An update is only delivered to builds whose `version`
  matches the one it was published against. **Bump `expo.version` whenever you
  add/remove a native module or change native config, then rebuild** — that is
  what stops an OTA update from landing on a binary that lacks the native code
  it needs.
- **Environment variables** — `mobile/.env` is gitignored and never reaches EAS
  servers. Builds read `EXPO_PUBLIC_*` from EAS environment variables (one set
  per environment: development / preview / production). Manage them with
  `eas env` or the expo.dev dashboard.

## One-time setup (requires your Expo account)

```bash
cd mobile
npm i -g eas-cli        # or use npx eas-cli
eas login
eas init                # links Coding-Moves/one-concept to an EAS project,
                        # writes the real projectId into app.json
eas update:configure    # writes updates.url (https://u.expo.dev/<projectId>)
```

Then create the environment variables for each environment (values from
`.env.example`; the Supabase anon key is public by design, but the production
API URL should be your deployed backend, not a LAN IP):

```bash
eas env:create --environment production --name EXPO_PUBLIC_API_BASE_URL
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_ANON_KEY
# repeat with --environment preview / development as needed
```

## First Android build → your phone

```bash
cd mobile
eas build --platform android --profile preview   # produces an installable APK
```

When it finishes, open the build page link (or expo.dev → project → builds) on
your phone and install the APK directly, or scan the QR code the CLI prints.
The `production` profile builds an AAB for Play Store submission; use
`preview` for sideloading.

## OTA update (JS, UI, styling, assets — no reinstall)

```bash
cd mobile
npm run update:production        # eas update --channel production
npm run update:preview           # eas update --channel preview
```

Installed apps fetch the update on next launch (`checkAutomatically: ON_LOAD`).

## Native change (new native dependency, plugin, icons, app.json native config)

OTA cannot ship native code. Instead:

1. Bump `expo.version` in [app.json](app.json) (e.g. 1.0.0 → 1.1.0).
2. `eas build --platform android --profile production` (and/or `preview`).
3. Reinstall the new binary on devices; subsequent OTA updates target the new
   runtime version.

## GitHub automation

Two workflows in [.github/workflows](../.github/workflows), both need the
`EXPO_TOKEN` repository secret (expo.dev → Account settings → Access tokens;
add at GitHub → Settings → Secrets and variables → Actions):

- **eas-update.yml** — every push to `main` touching `mobile/**` publishes an
  OTA update to the **production** channel automatically. Manual dispatch lets
  you pick `preview` instead.
- **eas-build.yml** — manual dispatch only (builds cost quota); choose the
  profile.
