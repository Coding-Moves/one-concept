import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { StreakStats } from '../services/streak';

export function StreakBadge({ streaks }: { streaks: StreakStats }) {
  return (
    <View style={styles.row}>
      <View style={styles.stat}>
        <Text style={styles.value}>🔥 {streaks.current}</Text>
        <Text style={styles.label}>day streak</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.value}>{streaks.longest}</Text>
        <Text style={styles.label}>longest</Text>
      </View>
      <View style={styles.stat}>
        <Text style={styles.value}>{streaks.totalLearned}</Text>
        <Text style={styles.label}>learned</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.sm + 4,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
  },
  value: {
    fontSize: 17,
    fontWeight: '700',
    color: colors.text,
  },
  label: {
    fontSize: 12,
    color: colors.textMuted,
  },
});
