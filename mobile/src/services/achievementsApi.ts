import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../api/client';
import { OfflineCache } from './offlineCache';
import { AchievementCollection, AchievementSnapshot, AchievementStore } from './achievementStore';

export const achievementCache = new OfflineCache<AchievementSnapshot>(AsyncStorage, 'one-concept/achievements/v1/');
export const createAchievementStore = (userId: string) => new AchievementStore(userId, achievementCache, {
  load: expectedUserId => apiRequest<AchievementCollection>('/v1/me/achievements', { expectedUserId }),
  acknowledge: (expectedUserId, codes) => apiRequest<void>('/v1/me/achievements/seen', {
    method: 'POST', body: { codes }, expectedUserId,
  }),
});
