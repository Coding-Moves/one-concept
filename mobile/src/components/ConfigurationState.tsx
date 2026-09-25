import { Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { spacing, scaleFont } from '../theme';

export function ConfigurationState() {
  const { colors } = useTheme();
  return (
    <View accessibilityRole="alert" style={{ flex: 1, justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.background }}>
      <Text style={{ color: colors.text, fontSize: scaleFont(24), fontWeight: '700', marginBottom: spacing.md }}>App setup is incomplete</Text>
      <Text style={{ color: colors.textMuted, fontSize: scaleFont(16) }}>Please install the latest app update. If this continues, contact the app maintainer.</Text>
    </View>
  );
}
