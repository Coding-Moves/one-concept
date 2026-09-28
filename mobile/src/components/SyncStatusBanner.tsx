import { Pressable, Text, View } from 'react-native';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { spacing, scaleFont } from '../theme';

export function SyncStatusBanner() {
  const { pausedSyncCount, retrySync } = useProgress();
  const { colors } = useTheme();
  if (!pausedSyncCount) return null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: colors.surface, padding: spacing.md }}>
      <Text style={{ color: colors.text, fontSize: scaleFont(14) }}>
        {pausedSyncCount} saved {pausedSyncCount === 1 ? 'change needs' : 'changes need'} another try to sync.
      </Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Retry saved changes" onPress={() => { void retrySync(); }} style={{ paddingVertical: spacing.sm }}>
        <Text style={{ color: colors.primary, fontWeight: '700' }}>Retry saved changes</Text>
      </Pressable>
    </View>
  );
}
