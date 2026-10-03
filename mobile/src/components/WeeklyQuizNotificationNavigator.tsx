import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { createQuizNotificationConsumer } from '../services/weeklyQuizNotificationIntent';

/** Mount only inside a ready, account-keyed navigation tree. */
export function WeeklyQuizNotificationNavigator({ ready, onOpen }: {
  ready: boolean;
  onOpen: (requestId: string) => void;
}) {
  useEffect(() => {
    if (!ready || Platform.OS === 'web') return;
    const consumer = createQuizNotificationConsumer(onOpen);
    const receive = (response: Notifications.NotificationResponse | null) => {
      if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const request = response.notification.request;
      if (consumer.consume(request.identifier, request.content.data)) {
        Notifications.clearLastNotificationResponse();
      }
    };
    const listener = Notifications.addNotificationResponseReceivedListener(receive);
    receive(Notifications.getLastNotificationResponse());
    return () => { consumer.dispose(); listener.remove(); };
  }, [ready, onOpen]);
  return null;
}
