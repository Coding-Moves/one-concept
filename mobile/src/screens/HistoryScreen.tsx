import { useRefreshControl } from '../hooks/useRefreshControl';
import { Ionicons } from '@expo/vector-icons';
import { CompositeNavigationProp, ParamListBase, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { FlatList, Pressable, TextInput, StyleSheet, Text, View } from 'react-native';
import { useHistory } from '../hooks/useHistory';
import { PrimaryButton } from '../components/PrimaryButton';
import { CategoryChip } from '../components/CategoryChip';
import { LikeCount } from '../components/LikeCount';
import { SkeletonRow } from '../components/Skeleton';
import { UnavailableState } from '../components/UnavailableState';
import { useOnline } from '../context/ConnectivityContext';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS_BY_ID } from '../data/concepts';
import { RootStackParamList } from '../navigation';
import { formatDateKey } from '../services/dates';
import { scaleIcon, scaleFont, radius, shadows, spacing, ThemeColors, typography } from '../theme';
import { Category, LearnedRecord } from '../types';


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
  const { loading, progress, refresh } = useProgress();
  const online = useOnline();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const refreshUI = useRefreshControl('history', refresh);
  // Composite: History is a tab screen that reaches up to the root stack's
  // concept-detail modal (#124).
  const navigation =
    useNavigation<
      CompositeNavigationProp<
        BottomTabNavigationProp<ParamListBase>,
        NativeStackNavigationProp<RootStackParamList>
      >
    >();

  const history = useHistory(progress);
  const [query, setQuery] = useState('');
  const records = history.records.filter(record =>
    `${record.title ?? prettify(record.conceptId)} ${record.topicName ?? ''}`
      .toLowerCase().includes(query.trim().toLowerCase()));
  const likedIds = useMemo(() => new Set(progress.likes), [progress.likes]);

  const open = (conceptId: string, title: string) =>
    navigation.navigate('ConceptDetail', { conceptId, title });

  return (
    <View style={styles.screen}>
      <FlatList
        refreshControl={refreshUI.control}
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
            {refreshUI.action}
            <Text style={styles.subtitle}>{history.records.length} of {progress.stats?.totalLearned ?? history.records.length} learned concepts loaded.</Text>
            <TextInput value={query} onChangeText={setQuery} style={styles.search}
              placeholder="Search loaded history" placeholderTextColor={colors.textSecondary}
              accessibilityLabel="Search loaded history" autoCapitalize="none" autoCorrect={false} />
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.list}>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </View>
          ) : query.trim() ? (
            <Text style={styles.subtitle}>No matches in loaded history. Load older lessons to keep looking.</Text>
          ) : !online && !progress.stats ? (
            <UnavailableState offline message="Connect to load your learning history on this device." onRetry={refresh} />
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
        ListFooterComponent={history.hasMore ? (
          <View style={styles.footer}>
            {history.failed ? <Text style={styles.subtitle}>Older lessons couldn’t be loaded. Downloaded pages remain available offline.</Text> : null}
            <PrimaryButton label={history.loading ? 'Loading older lessons…' : history.failed ? 'Retry older lessons' : 'Load older lessons'}
              disabled={history.loading} onPress={history.loadMore} />
          </View>
        ) : null}
        keyboardShouldPersistTaps="handled"
        ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
      />
    </View>
  );
}

type Styles = ReturnType<typeof createStyles>;

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    search: { color: colors.text, borderColor: colors.border, borderWidth: 1, borderRadius: radius.sm, padding: spacing.md, fontSize: scaleFont(16) },
    footer: { paddingVertical: spacing.lg, gap: spacing.sm },
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
