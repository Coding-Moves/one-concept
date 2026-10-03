import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, scaleFont, scaleIcon, touchTarget } from '../theme';

export function SyncStatusBanner() {
  const { pausedSyncCount, retrySync } = useProgress();
  const { colors } = useTheme();
  if (!pausedSyncCount) return null;
  return (
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.surfaceSubtle }]}>
      <Ionicons name="sync-outline" size={scaleIcon(19)} color={colors.primary} accessible={false} />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.text }]}>Saved changes need attention</Text>
        <Text style={[styles.message, { color: colors.textSecondary }]}>
          {pausedSyncCount} {pausedSyncCount === 1 ? 'change is' : 'changes are'} waiting to sync.
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Retry saved changes"
        accessibilityHint="Attempts to sync your saved changes now"
        onPress={() => { void retrySync(); }}
        style={({ pressed }) => [styles.action, pressed && { opacity: 0.72 }]}
      >
        <Text style={[styles.actionLabel, { color: colors.primary }]}>Retry</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  copy: { flex: 1, minWidth: 0, gap: 1 },
  title: { fontSize: scaleFont(14), fontWeight: '700' },
  message: { fontSize: scaleFont(12.5), lineHeight: scaleFont(17) },
  action: { minWidth: touchTarget, minHeight: touchTarget, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill, paddingHorizontal: spacing.xs },
  actionLabel: { fontSize: scaleFont(14), fontWeight: '700' },
});
