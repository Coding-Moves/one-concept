import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConceptCard } from '../components/ConceptCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { SkeletonBlock, SkeletonConceptCard } from '../components/Skeleton';
import { StreakBadge } from '../components/StreakBadge';
import { useProgress } from '../context/ProgressContext';
import { colors, radius, spacing, typography } from '../theme';

export function TodayScreen() {
  const { loading, concept, learnedToday, streaks, markLearned } = useProgress();

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.appName}>One Concept</Text>
        <Text style={styles.tagline}>One day. One concept. One small step forward.</Text>
      </View>

      {loading ? (
        <>
          <SkeletonBlock style={{ width: '100%', height: 64, borderRadius: radius.md }} />
          <Text style={styles.sectionLabel}>Today’s concept</Text>
          <SkeletonConceptCard />
          <SkeletonBlock style={{ width: '100%', height: 50, borderRadius: radius.md }} />
        </>
      ) : (
        <>
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
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: spacing.lg,
    paddingBottom: spacing.xl,
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
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  doneText: {
    color: colors.success,
    fontSize: 16,
    fontWeight: '600',
  },
});
