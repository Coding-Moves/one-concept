import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SkeletonBlock } from '../components/Skeleton';
import { StreakBadge } from '../components/StreakBadge';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { useTopics } from '../hooks/useTopics';
import { CONCEPTS } from '../data/concepts';
import { ServerTopic } from '../services/topicsApi';
import { radius, spacing, ThemeColors, typography } from '../theme';
import { LearnedRecord } from '../types';

interface CategoryProgress {
  label: string;
  learned: number;
  total: number;
}

/** Signed-out demo: totals come from the bundled 20-concept catalog. */
function demoCategoryProgress(learnedIds: Set<string>): CategoryProgress[] {
  const byCategory = new Map<string, CategoryProgress>();
  for (const concept of CONCEPTS) {
    const entry = byCategory.get(concept.category) ?? {
      label: concept.category,
      learned: 0,
      total: 0,
    };
    entry.total++;
    if (learnedIds.has(concept.id)) entry.learned++;
    byCategory.set(concept.category, entry);
  }
  return [...byCategory.values()];
}

/** Signed-in: totals come from the server catalog (topics.conceptCount), and
 *  learned counts are matched to a topic by its server-supplied name — so the
 *  bars reflect the 125+ real catalog, not the demo's 20 (issue #35). */
function serverCategoryProgress(
  topics: ServerTopic[],
  learned: LearnedRecord[]
): CategoryProgress[] {
  const learnedByTopic = new Map<string, number>();
  for (const record of learned) {
    if (record.topicName) {
      learnedByTopic.set(record.topicName, (learnedByTopic.get(record.topicName) ?? 0) + 1);
    }
  }
  return topics.map((t) => ({
    label: t.name,
    total: t.conceptCount,
    learned: learnedByTopic.get(t.name) ?? 0,
  }));
}

function ProgressBar({ fraction, styles }: { fraction: number; styles: Styles }) {
  // Clamp: a learned concept whose topic was later deactivated counts in the
  // learned total but not in any topic's conceptCount, which could otherwise
  // push a bar past its track.
  const pct = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%` }]} />
    </View>
  );
}

export function StatsScreen() {
  const { loading, progress, streaks } = useProgress();
  const { loading: topicsLoading, topics } = useTopics();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Server topics present => signed in: count against the real catalog. Empty
  // => signed-out demo: count against the bundled concepts.
  const serverMode = topics.length > 0;
  const categories = useMemo(
    () =>
      serverMode
        ? serverCategoryProgress(topics, progress.learned)
        : demoCategoryProgress(new Set(progress.learned.map((r) => r.conceptId))),
    [serverMode, topics, progress.learned]
  );
  const overall = serverMode
    ? {
        learned: progress.learned.length,
        total: topics.reduce((sum, t) => sum + t.conceptCount, 0),
      }
    : {
        learned: new Set(progress.learned.map((r) => r.conceptId)).size,
        total: CONCEPTS.length,
      };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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

          <View style={styles.card}>
            <View style={styles.overallRow}>
              <Text style={styles.cardTitle}>All concepts</Text>
              <Text style={styles.overallCount}>
                {overall.learned} / {overall.total}
              </Text>
            </View>
            <ProgressBar
              fraction={overall.total ? overall.learned / overall.total : 0}
              styles={styles}
            />
          </View>

          <Text style={styles.sectionLabel}>By category</Text>

          <View style={styles.card}>
            {categories.map((c) => (
              <View key={c.label} style={styles.categoryBlock}>
                <View style={styles.overallRow}>
                  <Text style={styles.categoryName}>{c.label}</Text>
                  <Text style={styles.categoryCount}>
                    {c.learned} / {c.total}
                  </Text>
                </View>
                <ProgressBar fraction={c.total ? c.learned / c.total : 0} styles={styles} />
              </View>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

type Styles = ReturnType<typeof createStyles>;

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
      fontSize: 17,
      color: colors.text,
    },
    overallRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    overallCount: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.primary,
    },
    categoryBlock: {
      gap: spacing.sm,
    },
    categoryName: {
      fontSize: 14,
      fontWeight: '600',
      color: colors.textSecondary,
      flexShrink: 1,
    },
    categoryCount: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
    },
    barTrack: {
      height: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.background,
      overflow: 'hidden',
    },
    barFill: {
      height: '100%',
      borderRadius: radius.pill,
      backgroundColor: colors.primary,
    },
  });
