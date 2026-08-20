import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ConceptCard } from '../components/ConceptCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { StreakBadge } from '../components/StreakBadge';
import { useDailyLearning } from '../hooks/useDailyLearning';
import { colors, spacing, typography } from '../theme';

export function HomeScreen() {
  const insets = useSafeAreaInsets();
  const { loading, concept, learnedToday, streaks, markLearned } = useDailyLearning();

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <View style={styles.header}>
        <Text style={styles.appName}>One Concept</Text>
        <Text style={styles.tagline}>One day. One concept. One small step forward.</Text>
      </View>

      <StreakBadge streaks={streaks} />

      <Text style={styles.sectionLabel}>Today’s concept</Text>

      {concept ? (
        <ConceptCard concept={concept} />
      ) : (
        <Text style={styles.tagline}>No concepts available.</Text>
      )}

      {learnedToday ? (
        <View style={styles.doneBox}>
          <Text style={styles.doneText}>✓ Learned today — see you tomorrow!</Text>
        </View>
      ) : (
        <PrimaryButton label="Mark as learned" onPress={markLearned} disabled={!concept} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  header: {
    gap: spacing.xs,
  },
  appName: {
    ...typography.title,
    color: colors.text,
  },
  tagline: {
    fontSize: 14,
    color: colors.textMuted,
  },
  sectionLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    marginBottom: -spacing.sm,
  },
  doneBox: {
    backgroundColor: colors.successSurface,
    borderRadius: 12,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  doneText: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '600',
  },
});
