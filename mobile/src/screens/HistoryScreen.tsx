import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryChip } from '../components/CategoryChip';
import { LikeCount } from '../components/LikeCount';
import { SkeletonRow } from '../components/Skeleton';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS } from '../data/concepts';
import { RootStackParamList } from '../navigation';
import { formatDateKey } from '../services/dates';
import { scaleIcon, scaleFont, radius, shadows, spacing, ThemeColors, typography } from '../theme';
import { Category, LearnedRecord } from '../types';

const CONCEPTS_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

// Keep the feed focused on recent activity (issue #124).
const HISTORY_LIMIT = 10;

function prettify(slug: string): string {
  return slug.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function HistoryRow({
  record,
  liked,
  styles,
  onOpen,
}: {
  record: LearnedRecord;
  liked: boolean;
  styles: Styles;
  onOpen: (conceptId: string, title: string) => void;
}) {
  // Server records carry their own names; the bundled catalog is only the
  // signed-out fallback, and a prettified slug beats a silently missing row.
  const local = CONCEPTS_BY_ID.get(record.conceptId);
  const title = record.title ?? local?.title ?? prettify(record.conceptId);
  const category = (record.topicName as Category | undefined) ?? local?.category;
  const likeTotal = (record.likeCount ?? 0) + (liked ? 1 : 0);
  return (
    <Pressable
      onPress={() => onOpen(record.conceptId, title)}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open ${title}`}
    >
      <View style={styles.rowText}>
        <Text style={styles.rowTitle}>{title}</Text>
        {/* Category and likes each get their own row, so the heart never
            wraps to a different line depending on chip width (issue #121). */}
        {category ? <CategoryChip category={category} /> : null}
        <LikeCount count={likeTotal} />
      </View>
      <Text style={styles.rowDate}>{formatDateKey(record.date)}</Text>
    </Pressable>
  );
}

export function HistoryScreen() {
  const { loading, progress } = useProgress();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  // Newest first, capped at the last HISTORY_LIMIT to keep the feed focused.
  const records = [...progress.learned]
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, HISTORY_LIMIT);
  const likedIds = useMemo(() => new Set(progress.likes), [progress.likes]);

  const open = (conceptId: string, title: string) =>
    navigation.navigate('ConceptDetail', { conceptId, title });

  return (
    <View style={styles.screen}>
      <FlatList
        data={loading ? [] : records}
        keyExtractor={(r) => `${r.date}-${r.conceptId}`}
        renderItem={({ item }) => (
          <HistoryRow
            record={item}
            liked={likedIds.has(item.conceptId)}
            styles={styles}
            onOpen={open}
          />
        )}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.title}>History</Text>
            <Text style={styles.subtitle}>Your last {HISTORY_LIMIT} concepts.</Text>
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
              <Ionicons name="library-outline" size={scaleIcon(40)} color={colors.textMuted} />
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
      fontSize: scaleFont(14),
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
    rowPressed: { opacity: 0.7 },
    rowText: {
      gap: spacing.sm,
      flexShrink: 1,
      alignItems: 'flex-start',
    },
    rowTitle: {
      fontSize: scaleFont(16),
      fontWeight: '600',
      color: colors.text,
    },
    rowDate: {
      fontSize: scaleFont(13),
      color: colors.textMuted,
    },
    empty: {
      alignItems: 'center',
      gap: spacing.sm,
      paddingVertical: spacing.xl * 2,
    },
    emptyTitle: {
      fontSize: scaleFont(17),
      fontWeight: '700',
      color: colors.text,
    },
    emptyText: {
      fontSize: scaleFont(14),
      color: colors.textMuted,
      textAlign: 'center',
    },
  });
