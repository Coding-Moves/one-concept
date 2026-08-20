import AsyncStorage from '@react-native-async-storage/async-storage';
import { CATEGORIES, ProgressState } from '../types';

const STORAGE_KEY = 'one-concept/progress/v1';

export const EMPTY_PROGRESS: ProgressState = {
  learned: [],
  assignment: null,
  followedTopics: [...CATEGORIES],
  likes: [],
  bookmarks: [],
};

export async function loadProgress(): Promise<ProgressState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PROGRESS;
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
    return EMPTY_PROGRESS;
  }
}

export async function saveProgress(progress: ProgressState): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}
