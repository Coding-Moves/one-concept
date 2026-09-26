import { Pressable, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleFont, spacing } from '../theme';
import { contactSupport } from './support';

/** Configuration is distinct from offline: queued writes cannot repair a bad build. */
export function ConfigurationState() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background, gap: spacing.md }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: scaleFont(24), fontWeight: '700' }}>App setup is incomplete</Text>
      <Text style={{ color: colors.textMuted, fontSize: scaleFont(16), lineHeight: scaleFont(23) }}>Please install the latest app update. If this continues, contact support.</Text>
      <Pressable accessibilityRole="link" accessibilityLabel="Contact support by email" onPress={() => contactSupport('One Concept app setup help')} style={{ minHeight: 48, justifyContent: 'center' }}>
        <Text style={{ color: colors.primary, fontSize: scaleFont(16), fontWeight: '700' }}>Contact support</Text>
      </Pressable>
    </View>
  );
}
