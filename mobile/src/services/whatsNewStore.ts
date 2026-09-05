import AsyncStorage from '@react-native-async-storage/async-storage';

// Device-global (not per-account): the "What's New" card is about the app
// version, so it should show once per version regardless of who is signed in.
const KEY = 'one-concept/last-seen-version/v1';

/** The app version whose "What's New" the user last dismissed, or null. */
export async function getLastSeenVersion(): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export async function setLastSeenVersion(version: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, version);
  } catch {
    // Best-effort: if we can't persist, the worst case is the card shows again
    // next launch — never a crash.
  }
}
