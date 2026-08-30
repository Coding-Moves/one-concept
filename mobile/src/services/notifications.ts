/**
 * Push reminders.
 *
 * The phone's only job is to hand its Expo push token to the backend; the
 * backend's cron decides who to nudge and when, in each user's timezone.
 * Everything here is fire-and-forget: a failure means no reminder, never a
 * broken app.
 */

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

/** Ask permission (first run only) and register this handset's token. */
export async function registerForReminders(): Promise<void> {
  if (!Device.isDevice) return; // emulators cannot receive pushes

  let { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') {
    ({ status } = await Notifications.requestPermissionsAsync());
  }
  if (status !== 'granted') return;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Daily reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
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
}

export function getNotificationPrefs(): Promise<NotificationPrefs> {
  return apiRequest<NotificationPrefs>('/v1/me/notifications');
}

export function putNotificationPrefs(prefs: NotificationPrefs): Promise<NotificationPrefs> {
  return apiRequest<NotificationPrefs>('/v1/me/notifications', { method: 'PUT', body: prefs });
}
