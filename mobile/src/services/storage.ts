import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATEGORIES, ProgressState } from '../types';

const STORAGE_KEY = 'one-concept/progress/v1';

export const EMPTY_PROGRESS: ProgressState = {
  learned: [],
  assignment: null,
  // A missing account state must never mean "follow everything".
  followedTopics: [],
  likes: [],
  bookmarks: [],
};

// The signed-out, on-device demo remains explicit so existing guest behavior
// and old guest records are not silently migrated to a different preference.
export const GUEST_PROGRESS: ProgressState = { ...EMPTY_PROGRESS, followedTopics: [...CATEGORIES] };

export async function loadProgress(): Promise<ProgressState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return GUEST_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<ProgressState>;
    return {
      learned: Array.isArray(parsed.learned) ? parsed.learned : [],
      assignment: parsed.assignment ?? null,
      // Fields added after the first release default for state saved before them.
      followedTopics: Array.isArray(parsed.followedTopics)
        ? parsed.followedTopics
        : [...CATEGORIES],
      likes: Array.isArray(parsed.likes) ? parsed.likes : [],
      bookmarks: Array.isArray(parsed.bookmarks) ? parsed.bookmarks : [],
    };
  } catch {
    // Corrupt or unreadable state: start fresh rather than crash on launch.
    return GUEST_PROGRESS;
  }
}

export async function saveProgress(progress: ProgressState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}
