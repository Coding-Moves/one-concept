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
 * CONTENT POLICY (issue #97): list ONLY new user-facing FEATURES. Do NOT list
 * bug fixes, memory/leak or performance fixes, UI/UX tweaks, or things removed —
 * the card celebrates what's genuinely new, not the changelog. Keep each line
 * plain, meaningful, and short; a few bullets at most. If a release has no new
 * feature, leave its highlights empty (or add no entry) and no card appears.
 */
export interface WhatsNewEntry {
  version: string;
  highlights: string[];
}

export const WHATS_NEW: WhatsNewEntry[] = [
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
