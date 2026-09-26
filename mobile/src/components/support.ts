import { Alert, Linking } from 'react-native';

export const SUPPORT_EMAIL = 'contactmuawia@gmail.com';

/** Opens a deliberately non-diagnostic support message. */
export function contactSupport(subject: string) {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}`;
  Linking.openURL(url).catch(() => {
    Alert.alert('Contact support', `Email us at ${SUPPORT_EMAIL}`);
  });
}
