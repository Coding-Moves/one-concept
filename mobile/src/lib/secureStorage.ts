import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage for the Supabase session.
 *
 * On device the session lives in the Keychain / Keystore via expo-secure-store,
 * which caps a value at about 2 KB — a session with a long access token can
 * exceed that, so values are split across numbered chunks.
 *
 * expo-secure-store has no web implementation, so the web build (used for
 * development) falls back to AsyncStorage.
 */
const CHUNK_SIZE = 1800;
const isWeb = Platform.OS === 'web';

const countKey = (key: string) => `${key}__chunks`;
const chunkKey = (key: string, index: number) => `${key}__${index}`;

async function clearChunks(key: string, count: number): Promise<void> {
  await Promise.all(
    Array.from({ length: count }, (_, i) => SecureStore.deleteItemAsync(chunkKey(key, i)))
  );
  await SecureStore.deleteItemAsync(countKey(key));
}

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    if (isWeb) return AsyncStorage.getItem(key);

    const rawCount = await SecureStore.getItemAsync(countKey(key));
    if (!rawCount) return null;

    const count = Number(rawCount);
    const parts = await Promise.all(
      Array.from({ length: count }, (_, i) => SecureStore.getItemAsync(chunkKey(key, i)))
    );
    // A missing chunk means a partial write; treat the value as absent so the
    // user is asked to sign in again rather than handed a corrupt session.
    return parts.every((p) => p !== null) ? parts.join('') : null;
  },

  async setItem(key: string, value: string): Promise<void> {
    if (isWeb) return AsyncStorage.setItem(key, value);

    const previous = Number((await SecureStore.getItemAsync(countKey(key))) ?? 0);
    if (previous) await clearChunks(key, previous);

    const chunks: string[] = [];
    for (let i = 0; i < value.length; i += CHUNK_SIZE) {
      chunks.push(value.slice(i, i + CHUNK_SIZE));
    }
    await Promise.all(
      chunks.map((chunk, i) => SecureStore.setItemAsync(chunkKey(key, i), chunk))
    );
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    if (isWeb) return AsyncStorage.removeItem(key);

    const count = Number((await SecureStore.getItemAsync(countKey(key))) ?? 0);
    if (count) await clearChunks(key, count);
  },
};
