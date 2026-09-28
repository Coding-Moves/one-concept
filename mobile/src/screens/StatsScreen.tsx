import { fetchTopics } from '../services/topicsApi';
import { useRefreshControl } from '../hooks/useRefreshControl';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SkeletonBlock } from '../components/Skeleton';
import { StreakBadge } from '../components/StreakBadge';
import { UnavailableState } from '../components/UnavailableState';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { useTopics } from '../hooks/useTopics';
import { CONCEPTS } from '../data/concepts';
import { ServerTopic } from '../services/topicsApi';
import { scaleFont, radius, spacing, ThemeColors, typography } from '../theme';
import { LearnedRecord } from '../types';
import { learnedTopicCounts } from '../services/progressTotals';

interface CategoryProgress {
  label: string;
  learned: number;
}

/** Signed-out demo: totals come from the bundled 20-concept catalog. */
function demoCategoryProgress(learnedIds: Set<string>): CategoryProgress[] {
  const byCategory = new Map<string, CategoryProgress>();
  for (const concept of CONCEPTS) {
    const entry = byCategory.get(concept.category) ?? {
      label: concept.category,
      learned: 0,
    };
    if (learnedIds.has(concept.id)) entry.learned++;
    byCategory.set(concept.category, entry);
  }
  return [...byCategory.values()];
}

/** Keep completed counts independent of the growing server catalog. */
function serverCategoryProgress(
  topics: ServerTopic[],
  learned: LearnedRecord[],
  beforeWindow?: Record<string, number>,
): CategoryProgress[] {
  const learnedByTopic = learnedTopicCounts(learned, beforeWindow);
  return topics.map((t) => ({
    label: t.name,
    learned: learnedByTopic.get(t.name) ?? 0,
  }));
}

export function StatsScreen() {
  const { loading, progress, streaks, refresh } = useProgress();
  const { loading: topicsLoading, topics, error, retry } = useTopics();
  const { session } = useAuth();
  const online = useOnline();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const refreshUI = useRefreshControl('stats', async () => { await refresh(); await fetchTopics(); });

  // A failed catalog request must not substitute demo totals for a real account.
  const serverMode = !!session;
  const categories = useMemo(
    () =>
      serverMode
        ? serverCategoryProgress(topics, progress.learned, progress.learnedBeforeWindow)
        : demoCategoryProgress(new Set(progress.learned.map((r) => r.conceptId))),
    [serverMode, topics, progress.learned, progress.learnedBeforeWindow]
  );
  const totalLearned = serverMode
    ? progress.stats?.totalLearned ?? progress.learned.length
    : new Set(progress.learned.map((r) => r.conceptId)).size;
  const totalReviews = progress.stats?.totalReviews;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={refreshUI.control}>
      {refreshUI.action}
      <View style={styles.header}>
        <Text style={styles.title}>Stats</Text>
        <Text style={styles.subtitle}>Your learning progress over time.</Text>
      </View>

      {loading || topicsLoading ? (
        <>
          <SkeletonBlock style={{ width: '100%', height: 64, borderRadius: radius.md }} />
          <SkeletonBlock style={{ width: '100%', height: 220, borderRadius: radius.lg }} />
        </>
      ) : (
        <>
          <StreakBadge streaks={streaks} />

          {error && topics.length === 0 ? (
            <UnavailableState
              offline={!online}
              error={error}
              message="Connect to load your topic breakdown. Your saved progress is still here."
              onRetry={retry}
            />
          ) : (
            <>
              <View style={styles.card}>
                <View style={styles.overallRow}>
                  <Text style={styles.cardTitle}>Concepts learned</Text>
                  <Text style={styles.overallCount}>
                    {totalLearned}
                  </Text>
                </View>
              </View>

              <Text style={styles.sectionLabel}>By category</Text>

              <View style={styles.card}>
                {categories.map((c) => (
                  <View key={c.label} style={styles.categoryBlock}>
                    <View style={styles.overallRow}>
                      <Text style={styles.categoryName}>{c.label}</Text>
                      <Text style={styles.categoryCount}>
                        {c.learned} learned
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </>
          )}
          <View style={styles.reviewSummary}>
            <Text style={styles.reviewCount}>
              {totalReviews == null ? 'Review activity unavailable' : totalReviews === 0
                ? 'No reviews completed yet'
                : `${totalReviews} ${totalReviews === 1 ? 'review' : 'reviews'} completed`}
            </Text>
            <Text style={styles.subtitle}>Reviews revisit a learned concept and count toward your streak.</Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
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
    title: {
      ...typography.title,
      color: colors.text,
    },
    subtitle: {
      fontSize: scaleFont(14),
      color: colors.textMuted,
    },
    sectionLabel: {
      fontSize: scaleFont(13),
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: -spacing.sm,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    cardTitle: {
      ...typography.heading,
      fontSize: scaleFont(17),
      color: colors.text,
    },
    overallRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
      columnGap: spacing.md,
      rowGap: spacing.xs,
    },
    overallCount: {
      fontSize: scaleFont(15),
      fontWeight: '700',
      color: colors.primary,
    },
    categoryBlock: {
      gap: spacing.sm,
    },
    categoryName: {
      fontSize: scaleFont(14),
      fontWeight: '600',
      color: colors.textSecondary,
      flexShrink: 1,
    },
    categoryCount: {
      fontSize: scaleFont(13),
      fontWeight: '600',
      color: colors.textMuted,
    },
    reviewSummary: {
      gap: spacing.xs,
      paddingHorizontal: spacing.xs,
    },
    reviewCount: {
      fontSize: scaleFont(14),
      fontWeight: '600',
      color: colors.textSecondary,
    },
  });
