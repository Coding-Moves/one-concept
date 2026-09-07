import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { scaleFont, scaleIcon, spacing, ThemeColors } from '../theme';

/**
 * Thin app-wide strip shown while offline. Rendered above the navigator so it
 * pushes content down (no overlap) and disappears cleanly when back online.
 * Sits under the status bar via the top safe-area inset.
 */
export function OfflineBanner() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(colors);
  return (
    <View
      style={[styles.container, { paddingTop: insets.top }]}
      accessibilityRole="alert"
      accessibilityLabel="You are offline. Changes will sync when you reconnect."
    >
      <View style={styles.row}>
        <Ionicons name="cloud-offline-outline" size={scaleIcon(14)} color={colors.onPrimary} />
        <Text style={styles.text}>Offline — changes will sync when you reconnect</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { backgroundColor: colors.textMuted },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.xs + 2,
      paddingVertical: spacing.xs + 2,
      paddingHorizontal: spacing.md,
    },
    text: { fontSize: scaleFont(12), fontWeight: '600', color: colors.onPrimary },
  });
