/**
 * Push reminders.
 *
 * The phone's only job is to hand its Expo push token to the backend; the
 * backend's cron decides who to nudge and when, in each user's timezone.
 * Everything here is fire-and-forget: a failure means no reminder, never a
 * broken app.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { apiRequest } from '../api/client';

export interface NotificationPrefs {
  enabled: boolean;
  reminder_times: string[]; // "HH:MM" in the user's profile timezone
}

// Reminders arrive while the app is closed; if one lands with the app open,
// show it quietly.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

/**
 * Keep the server's idea of "your day" aligned with the phone's clock.
 * Reminder times and streak boundaries are computed in this zone.
 */
export async function syncTimezone(): Promise<void> {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (!timezone) return;
  await apiRequest<unknown>('/v1/me', { method: 'PATCH', body: { timezone } });
}

/** Ask permission (first run only) and register this handset's token. */
export async function registerForReminders(): Promise<void> {
  if (!Device.isDevice) return; // emulators cannot receive pushes

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    // A fresh channel id: Android freezes a channel's importance after first
    // creation, so upgrading the old quiet 'default' channel in place is
    // impossible — 'reminders' starts loud from day one.
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Daily reminders',
      importance: Notifications.AndroidImportance.HIGH,
      sound: 'default',
      vibrationPattern: [0, 250, 250, 250],
    });
  }

  const projectId = Constants.expoConfig?.extra?.eas?.projectId as string | undefined;
  const token = (
    await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)
  ).data;

  await apiRequest<void>('/v1/me/push-token', {
    method: 'POST',
    body: {
      expo_push_token: token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    },
  });
  // Remembered so sign-out can deregister without asking Expo again. Not in
  // clearAccountCaches: deregistration consumes it, then removes it itself.
  AsyncStorage.setItem(REGISTERED_TOKEN_KEY, token).catch(() => {});
}

const REGISTERED_TOKEN_KEY = 'one-concept/push-token/v1';

const PREFS_CACHE_KEY = 'one-concept/notification-prefs/v1';

function rememberPrefs(prefs: NotificationPrefs): NotificationPrefs {
  AsyncStorage.setItem(PREFS_CACHE_KEY, JSON.stringify(prefs)).catch(() => {});
  return prefs;
}

/** Last known preferences from disk; keeps the settings row visible offline. */
export async function getCachedNotificationPrefs(): Promise<NotificationPrefs | null> {
  const raw = await AsyncStorage.getItem(PREFS_CACHE_KEY).catch(() => null);
  try {
    return raw ? (JSON.parse(raw) as NotificationPrefs) : null;
  } catch {
    return null;
  }
}

export async function getNotificationPrefs(): Promise<NotificationPrefs> {
  return rememberPrefs(await apiRequest<NotificationPrefs>('/v1/me/notifications'));
}

export async function putNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  return rememberPrefs(
    await apiRequest<NotificationPrefs>('/v1/me/notifications', { method: 'PUT', body: prefs })
  );
}

/**
 * Tell the server to stop sending this account's reminders to this handset.
 * Must run BEFORE the session is revoked — it is an authenticated call.
 * Best-effort: offline, the registration stays and the server's dead-token
 * cleanup or the next account's re-registration takes over.
 */
export async function deregisterForReminders(): Promise<void> {
  const token = await AsyncStorage.getItem(REGISTERED_TOKEN_KEY).catch(() => null);
  if (!token) return;
  await apiRequest<void>('/v1/me/push-token', {
    method: 'DELETE',
    body: { expo_push_token: token },
  });
  await AsyncStorage.removeItem(REGISTERED_TOKEN_KEY).catch(() => {});
}

/** Called on sign-out; reminder times are account data, not device data. */
export async function clearNotificationPrefsCache(): Promise<void> {
  await AsyncStorage.removeItem(PREFS_CACHE_KEY).catch(() => {});
}
