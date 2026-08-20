import { FlatList, StyleSheet, Text, View } from 'react-native';
import { CategoryChip } from '../components/CategoryChip';
import { SkeletonRow } from '../components/Skeleton';
import { useProgress } from '../context/ProgressContext';
import { CONCEPTS } from '../data/concepts';
import { formatDateKey } from '../services/dates';
import { colors, radius, spacing, typography } from '../theme';
import { LearnedRecord } from '../types';

const CONCEPTS_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

function HistoryRow({ record }: { record: LearnedRecord }) {
  const concept = CONCEPTS_BY_ID.get(record.conceptId);
  if (!concept) return null;
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{concept.title}</Text>
        <CategoryChip category={concept.category} />
      </View>
      <Text style={styles.rowDate}>{formatDateKey(record.date)}</Text>
    </View>
  );
}

export function HistoryScreen() {
  const { loading, progress } = useProgress();

  const records = [...progress.learned].sort((a, b) => (a.date < b.date ? 1 : -1));

  return (
    <View style={styles.screen}>
      <FlatList
        data={loading ? [] : records}
        keyExtractor={(r) => `${r.date}-${r.conceptId}`}
        renderItem={({ item }) => <HistoryRow record={item} />}
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
              <Text style={styles.emptyEmoji}>📚</Text>
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

const styles = StyleSheet.create({
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
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  rowText: {
    gap: spacing.sm,
    flexShrink: 1,
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
  emptyEmoji: {
    fontSize: 40,
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
