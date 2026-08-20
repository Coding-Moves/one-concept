import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors } from '../theme';
import { StreakStats } from '../services/streak';

export function StreakBadge({ streaks }: { streaks: StreakStats }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row}>
      <View style={styles.stat}>
        <View style={styles.valueRow}>
          <Ionicons name="flame" size={16} color={colors.streak} />
          <Text style={styles.value}>{streaks.current}</Text>
        </View>
        <Text style={styles.label}>day streak</Text>
      </View>
      <View style={styles.stat}>
        <View style={styles.valueRow}>
          <Ionicons name="trophy-outline" size={15} color={colors.textMuted} />
          <Text style={styles.value}>{streaks.longest}</Text>
        </View>
        <Text style={styles.label}>longest</Text>
      </View>
      <View style={styles.stat}>
        <View style={styles.valueRow}>
          <Ionicons name="library-outline" size={15} color={colors.textMuted} />
          <Text style={styles.value}>{streaks.totalLearned}</Text>
        </View>
        <Text style={styles.label}>learned</Text>
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    valueRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
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
