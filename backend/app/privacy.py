"""Public privacy-policy page. Keep this aligned with the data flows in code."""

PRIVACY_POLICY = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>One Concept — Privacy Policy</title>
  <style>
    :root { color-scheme: light dark; }
    body { margin: 0; background: #0f1115; color: #e8eaf0;
           font: 16px/1.65 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    main { max-width: 760px; margin: 0 auto; padding: 40px 24px 64px; }
    h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 0.5rem; }
    h2 { font-size: 1.2rem; margin: 2rem 0 0.5rem; }
    p, li { color: #c5cad6; }
    .updated { color: #9aa1b0; margin: 0; }
    a { color: #9fb2ff; }
    strong { color: #f5f7fb; }
  </style>
</head>
<body>
  <main>
    <h1>Privacy Policy</h1>
    <p class="updated">Effective: September 25, 2026</p>
    <p>One Concept is operated by Coding Moves. This policy explains the data
       used to provide the app and how to contact us about it.</p>

    <h2>Information used to provide the app</h2>
    <ul>
      <li><strong>Account information:</strong> your email address and authentication
          session are handled by Supabase Auth. The app uses the verified account
          identity to keep your data separate from other users.</li>
      <li><strong>Profile and learning information:</strong> a display name, timezone,
          followed topics, daily assignments, completed lessons and reviews, streaks,
          likes, saved concepts, and reminder preferences.</li>
      <li><strong>Notification information:</strong> if you grant notification
          permission, the app sends an Expo push token and your device platform to
          our server so it can deliver the reminder times you choose.</li>
      <li><strong>Device-local information:</strong> encrypted authentication data and
          app caches may be stored on your device so the app can reopen and show
          recent learning content while offline.</li>
    </ul>

    <h2>How we use information</h2>
    <p>We use this information to sign you in, select and remember daily learning,
       calculate streaks, keep your saved and liked content, and send reminders
       when you enable them. We do not use the app for advertising, and the app
       does not include behavioural analytics or crash-reporting SDKs.</p>

    <h2>Service providers</h2>
    <p>We use Supabase to provide authentication and database infrastructure.
       We use Expo's push-notification service to deliver reminders when enabled.
       These providers process the information needed to operate those services.
       Our backend hosting provider processes requests needed to run the app.</p>

    <h2>Choices and retention</h2>
    <p>You can turn reminders off in the app. Signing out removes account-scoped
       app caches and attempts to deregister the current device from reminders
       while it is online. Account and learning data remain associated with your
       account until you ask us to delete them or we no longer need them to run
       the service.</p>

    <h2>Security</h2>
    <p>Application requests use a verified account token, and access controls are
       designed to limit data access to the signed-in account. No method of
       internet transmission or storage is completely secure.</p>

    <h2>Your requests and contact</h2>
    <p>You can request access to, correction of, or deletion of your account data
       by emailing <a href="mailto:contactmuawia@gmail.com">contactmuawia@gmail.com</a>
       from the address associated with your account. We may need to verify the
       request before acting on it.</p>

    <h2>Changes to this policy</h2>
    <p>We may update this policy when the app or its data practices change. The
       current version is published at this address, with its effective date.</p>
  </main>
</body>
</html>"""
