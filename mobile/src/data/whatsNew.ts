import Constants from 'expo-constants';

/**
 * Release highlights shown in the one-time "What's New" card.
 *
 * The current version is read from the running app (`expo.version` in
 * app.config.js, via expo-constants) — the single source of truth — so it can
 * never drift from what's shipped. Each release, add an entry here whose
 * `version` matches the new `expo.version`. A version with no matching entry
 * simply shows no card.
 *
 * CONTENT POLICY: every release includes a nonempty entry focused on new
 * features and user-visible improvements — what's new and what's better.
 * Describe real benefits in a few short bullets, not error lists, technical
 * diagnostics, or internal maintenance. This replaces the features-only rule
 * from issue #97 at the owner's request; see RELEASING.md.
 */
export interface WhatsNewEntry {
  version: string;
  highlights: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '1.10.1',
    highlights: [
      'Recover gracefully when the service is unavailable, with clear next steps instead of technical error messages.',
      'Keep your saved learning changes visible and retry them when a connection or server problem pauses syncing.',
      'Switch accounts with stronger protection for your saved lessons and pending learning activity.',
      'Get clearer guidance when your app setup needs attention, so connection problems are easier to understand.',
    ],
  },
  {
    version: '1.10.0',
    highlights: [
      'Earn permanent badges for your learning streaks, with credit for milestones you have already reached.',
      'Explore your achievement collection from Profile and see your next milestone.',
      'Celebrate newly earned badges together, then revisit them whenever you like.',
      'Read our privacy policy directly from About to understand how your data is handled.',
    ],
  },
  {
    version: '1.9.1',
    highlights: [
      'Keep your learning streak going with daily reviews when no new lesson is available.',
      'Explore your full learning history, load older lessons, and search what you have loaded.',
      'Pull or tap to refresh your learning screens, with downloaded lessons available offline.',
      'Enjoy clearer offline notices and profile details that adapt to larger text.',
    ],
  },
  {
    version: '1.9.0',
    highlights: [
      'Keep learning with daily reviews when you have explored the available new lessons.',
      'Revisit your complete learning history and search the lessons you have loaded.',
      'Refresh your learning screens with a pull or a tap, while keeping downloaded content available offline.',
      'Read clearer offline notices and see your full profile details at larger text sizes.',
    ],
  },
  {
    version: '1.8.0',
    highlights: [
      'Read saved lessons and examples offline after they download to your device.',
      'Likes, saves, and progress sync automatically when you reconnect or reopen the app.',
      'Choose topics offline and keep your selections between visits.',
      'Enjoy a lighter startup and find older saved lessons with search and topic filters.',
      'Show or hide your password when signing in or creating an account.',
      'Refreshed account emails make confirmation, password resets, and security updates clearer.',
    ],
  },
  {
    version: '1.7.1',
    highlights: [
      'Stay signed in and keep reading cached lessons on a weak connection.',
      'Animated offline screens now include a Try again button to reload missing content.',
      'Clearer sign-in guidance when your connection is unavailable.',
    ],
  },
  {
    version: '1.7.0',
    highlights: [
      'Works offline — read, like, save, and mark concepts learned with no connection, and everything syncs automatically the moment you’re back online.',
    ],
  },
  {
    version: '1.6.0',
    highlights: [
      'Saved concepts now has its own screen — search your saves and filter them by topic.',
    ],
  },
  {
    version: '1.5.0',
    highlights: [
      'Forgot your password? You can now reset it right from the sign-in screen.',
      'Tap any concept in History or your Saved list to open it again in full.',
      'The About screen now links to our GitHub and a quick way to send feedback.',
    ],
  },
  {
    version: '1.4.1',
    highlights: [
      'New About screen — tap About on your profile to see the app version and what One Concept is all about.',
    ],
  },
  {
    version: '1.4.0',
    highlights: [
      'See how loved a concept is — every card now shows how many people have liked it.',
    ],
  },
];

/** The running app's version, or null if it can't be read. */
export const CURRENT_VERSION: string | null = Constants.expoConfig?.version ?? null;

/** Highlights for the version the app is currently running, if any are defined. */
export function currentEntry(): WhatsNewEntry | null {
  if (!CURRENT_VERSION) return null;
  return WHATS_NEW.find((e) => e.version === CURRENT_VERSION) ?? null;
}
