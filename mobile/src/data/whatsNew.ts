/**
 * Release highlights shown in the one-time "What's New" card.
 *
 * The FIRST entry is the current version — its `version` is the source of truth
 * the card compares against the last version the user dismissed. Bump this in
 * lockstep with `expo.version` in app.config.js on every release (native or OTA)
 * and lead with plain, user-facing highlights — not changelog jargon.
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

/** The version the app is currently on, by construction the newest entry. */
export const CURRENT_VERSION = WHATS_NEW[0].version;
