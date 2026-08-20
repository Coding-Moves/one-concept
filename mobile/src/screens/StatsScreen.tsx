import { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SkeletonBlock } from '../components/Skeleton';
import { StreakBadge } from '../components/StreakBadge';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS } from '../data/concepts';
import { radius, spacing, ThemeColors, typography } from '../theme';
import { Category } from '../types';

interface CategoryProgress {
  category: Category;
  learned: number;
  total: number;
}

function computeCategoryProgress(learnedIds: Set<string>): CategoryProgress[] {
  const byCategory = new Map<Category, CategoryProgress>();
  for (const concept of CONCEPTS) {
    const entry = byCategory.get(concept.category) ?? {
      category: concept.category,
      learned: 0,
      total: 0,
    };
    entry.total++;
    if (learnedIds.has(concept.id)) entry.learned++;
    byCategory.set(concept.category, entry);
  }
  return [...byCategory.values()];
}

function ProgressBar({ fraction, styles }: { fraction: number; styles: Styles }) {
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${Math.round(fraction * 100)}%` }]} />
    </View>
  );
}

export function StatsScreen() {
  const { loading, progress, streaks } = useProgress();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const learnedIds = new Set(progress.learned.map((r) => r.conceptId));
  const categories = computeCategoryProgress(learnedIds);
  const overall = { learned: learnedIds.size, total: CONCEPTS.length };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Stats</Text>
        <Text style={styles.subtitle}>Your learning progress over time.</Text>
      </View>

      {loading ? (
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
              <View key={c.category} style={styles.categoryBlock}>
                <View style={styles.overallRow}>
                  <Text style={styles.categoryName}>{c.category}</Text>
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
