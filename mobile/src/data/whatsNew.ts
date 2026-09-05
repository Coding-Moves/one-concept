import Constants from 'expo-constants';

/**
 * Release highlights shown in the one-time "What's New" card.
 *
 * The current version is read from the running app (`expo.version` in
 * app.config.js, via expo-constants) — the single source of truth — so it can
 * never drift from what's shipped. Each release, add an entry here whose
 * `version` matches the new `expo.version`, with plain, user-facing highlights.
 * A version with no matching entry simply shows no card.
 */
export interface WhatsNewEntry {
  version: string;
  highlights: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
  {
    version: '1.3.0',
    highlights: [
      'Your daily concept opens instantly — the next lessons are prepared ahead of time, so you never wait.',
      'Stats and progress now count against the full library, so your numbers and streaks are accurate.',
      'Smoother, more reliable reminders and syncing across your devices.',
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
