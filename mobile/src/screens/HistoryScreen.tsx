import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { CategoryChip } from '../components/CategoryChip';
import { LikeCount } from '../components/LikeCount';
import { SkeletonRow } from '../components/Skeleton';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS } from '../data/concepts';
import { formatDateKey } from '../services/dates';
import { radius, shadows, spacing, ThemeColors, typography } from '../theme';
import { Category, LearnedRecord } from '../types';

const CONCEPTS_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

function prettify(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function HistoryRow({
  record,
  liked,
  styles,
}: {
  record: LearnedRecord;
  liked: boolean;
  styles: Styles;
}) {
  // Server records carry their own names; the bundled catalog is only the
  // signed-out fallback, and a prettified slug beats a silently missing row.
  const local = CONCEPTS_BY_ID.get(record.conceptId);
  const title = record.title ?? local?.title ?? prettify(record.conceptId);
  const category = (record.topicName as Category | undefined) ?? local?.category;
  const likeTotal = (record.likeCount ?? 0) + (liked ? 1 : 0);
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        <View style={styles.metaRow}>
          {category ? <CategoryChip category={category} /> : null}
          <LikeCount count={likeTotal} />
        </View>
      </View>
      <Text style={styles.rowDate}>{formatDateKey(record.date)}</Text>
    </View>
  );
}

export function HistoryScreen() {
  const { loading, progress } = useProgress();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const records = [...progress.learned].sort((a, b) => (a.date < b.date ? 1 : -1));
  const likedIds = new Set(progress.likes);

  return (
    <View style={styles.screen}>
      <FlatList
        data={loading ? [] : records}
        keyExtractor={(r) => `${r.date}-${r.conceptId}`}
        renderItem={({ item }) => (
          <HistoryRow record={item} liked={likedIds.has(item.conceptId)} styles={styles} />
        )}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>History</Text>
            <Text style={styles.subtitle}>Everything you’ve learned so far.</Text>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.list}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          ) : (
            <View style={styles.empty}>
              <Ionicons name="library-outline" size={40} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>Nothing here yet</Text>
              <Text style={styles.emptyText}>
                Learn today’s concept and it will show up here.
              </Text>
            </View>
          )
        }
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </View>
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
    },
    header: {
      gap: spacing.xs,
      marginBottom: spacing.lg,
    },
    title: {
      ...typography.title,
      color: colors.text,
    },
    subtitle: {
      fontSize: 14,
      color: colors.textMuted,
    },
    list: {
      gap: spacing.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.card,
    },
    rowText: {
      gap: spacing.sm,
      flexShrink: 1,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      flexWrap: 'wrap',
    },
    rowTitle: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.text,
    },
    rowDate: {
      fontSize: 13,
      color: colors.textMuted,
    },
    empty: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xl * 2,
    },
    emptyTitle: {
      fontSize: 17,
      fontWeight: '700',
      color: colors.text,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
