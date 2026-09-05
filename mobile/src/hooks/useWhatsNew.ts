import { useCallback, useEffect, useState } from 'react';
import { CURRENT_VERSION, WHATS_NEW, WhatsNewEntry } from '../data/whatsNew';
import { getLastSeenVersion, setLastSeenVersion } from '../services/whatsNewStore';

export interface WhatsNew {
  /** The entry to show, or null when there is nothing new to announce. */
  entry: WhatsNewEntry | null;
  /** Dismiss the card and remember this version so it never shows again. */
  dismiss: () => void;
}

/**
 * Decides whether to show the one-time "What's New" card. It appears once when
 * the app's version changes (native install or OTA) and never again for that
 * version once dismissed.
 */
export function useWhatsNew(): WhatsNew {
  const [entry, setEntry] = useState<WhatsNewEntry | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const lastSeen = await getLastSeenVersion();
      if (!active) return;
      // Show whenever the last dismissed version isn't the current one — which
      // includes the first launch after this feature ships, so the update is
      // announced rather than silently missed.
      if (lastSeen !== CURRENT_VERSION) {
        setEntry(WHATS_NEW[0]);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const dismiss = useCallback(() => {
    setEntry(null);
    // Fire-and-forget: persistence failing only means it may reappear next
    // launch, never a crash.
    setLastSeenVersion(CURRENT_VERSION);
  }, []);

  return { entry, dismiss };
}
