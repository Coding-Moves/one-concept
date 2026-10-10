import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = 'one-concept/profile-photo-picker/v1';

/** Only the initiating account may recover a picker result after Android recreates the app. */
export async function beginProfilePhotoPick(userId: string): Promise<void> {
  await AsyncStorage.setItem(KEY, userId);
}

export async function claimProfilePhotoPick(userId: string): Promise<boolean> {
  const owner = await AsyncStorage.getItem(KEY);
  if (owner !== userId) return false;
  await AsyncStorage.removeItem(KEY);
  return true;
}

export async function clearProfilePhotoPick(): Promise<void> {
  await AsyncStorage.removeItem(KEY);
}
