import { useRefreshControl } from '../hooks/useRefreshControl';
import { Ionicons } from '@expo/vector-icons';
import { CompositeNavigationProp, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { CollectionConceptRow } from '../components/CollectionConceptRow';
import { SearchField } from '../components/SearchField';
import { UnavailableState } from '../components/UnavailableState';
import { useOnline } from '../context/ConnectivityContext';
import { useProgress } from '../context/ProgressContext';
import { useSavedConcepts } from '../hooks/useSavedConcepts';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS_BY_ID } from '../data/concepts';
import { RootStackParamList } from '../navigation';
import { radius, scaleFont, scaleIcon, spacing, ThemeColors, typography } from '../theme';
import { ProfileStackParamList } from './ProfileScreen';

interface SavedItem {
  id: string;
  title: string;
  topicName?: string;
  likes: number;
}

type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<ProfileStackParamList, 'Saved'>,
  NativeStackNavigationProp<RootStackParamList>
>;

const ALL = 'All';

/** Dedicated Saved-concepts screen with search + category filter, so the list
 *  no longer clutters the Profile scroll (issue #131). */
export function SavedScreen() {
  const navigation = useNavigation<Nav>();
  const { progress, refresh } = useProgress();
  const online = useOnline();
  const { savedConcepts, loading, failed, retry } = useSavedConcepts(progress);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const refreshUI = useRefreshControl('saved lessons', async () => { await refresh(); retry(); });

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string>(ALL);

  const likedIds = useMemo(() => new Set(progress.likes), [progress.likes]);

  // Server state carries titles/topics; the signed-out demo resolves bookmark
  // ids against the bundled catalog (issue #90).
  const saved: SavedItem[] = useMemo(() => {
    if (savedConcepts) {
      return savedConcepts.map((s) => ({
        id: s.conceptId,
        title: s.title,
        topicName: s.topicName,
        likes: (s.likeCount ?? 0) + (likedIds.has(s.conceptId) ? 1 : 0),
      }));
    }
    return progress.bookmarks
      .map((id) => CONCEPTS_BY_ID.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)
      .map((c) => ({
        id: c.id,
        title: c.title,
        topicName: c.category as string,
        likes: likedIds.has(c.id) ? 1 : 0,
      }));
  }, [savedConcepts, progress.bookmarks, likedIds]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    saved.forEach((s) => s.topicName && set.add(s.topicName));
    return [ALL, ...[...set].sort()];
  }, [saved]);

  // If the selected category no longer exists among saved concepts (e.g. the
  // user unsaved its last one), fall back to All so the list can't get stuck
  // empty with an invisible filter.
  const effectiveCategory = categories.includes(category) ? category : ALL;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return saved.filter(
      (s) =>
        (effectiveCategory === ALL || s.topicName === effectiveCategory) &&
        (q === '' || s.title.toLowerCase().includes(q))
    );
  }, [saved, query, effectiveCategory]);

  return (
    <View style={styles.screen}>
      <View style={{paddingHorizontal: spacing.md}}>{refreshUI.action}</View>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={scaleIcon(24)} color={colors.text} />
        </Pressable>
        <Text style={styles.title}>Saved concepts</Text>
        <View style={styles.iconButton} />
      </View>

      {loading ? (
        <View style={styles.loadStatus}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.emptyText}>Loading more saved concepts…</Text>
        </View>
      ) : failed ? (
        <Pressable onPress={retry} accessibilityRole="button" style={styles.loadStatus}>
          <Text style={styles.emptyText}>
            {online ? 'Some saved concepts could not be refreshed. Tap to retry.'
              : 'Showing downloaded concepts. Connect and tap to load more.'}
          </Text>
        </Pressable>
      ) : null}

      {saved.length === 0 && (loading || failed) ? null : saved.length === 0 && !online && !progress.stats ? (
        <UnavailableState offline message="Connect to load your saved concepts on this device." onRetry={refresh} />
      ) : saved.length === 0 ? (
        <View style={styles.empty}>
          <Ionicons name="bookmark-outline" size={scaleIcon(40)} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>Nothing saved yet</Text>
          <Text style={styles.emptyText}>
            Tap the bookmark on a concept to keep it here for later.
          </Text>
        </View>
      ) : (
        <>
          <View style={styles.searchWrap}>
            <SearchField
              value={query}
              onChangeText={setQuery}
              placeholder="Search saved concepts"
              accessibilityLabel="Search saved concepts"
            />
          </View>

          {categories.length > 2 ? (
            <FlatList
              data={categories}
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyExtractor={(c) => c}
              style={styles.filterRow}
              contentContainerStyle={styles.filterContent}
              renderItem={({ item }) => {
                const active = item === effectiveCategory;
                return (
                  <Pressable
                    onPress={() => setCategory(item)}
                    style={[styles.filterChip, active && styles.filterChipActive]}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                  >
                    <Text style={[styles.filterText, active && styles.filterTextActive]}>
                      {item}
                    </Text>
                  </Pressable>
                );
              }}
            />
          ) : null}

          <FlatList
            refreshControl={refreshUI.control}
            data={filtered}
            keyExtractor={(c) => c.id}
            contentContainerStyle={styles.listContent}
            ItemSeparatorComponent={() => <View style={{ height: spacing.sm }} />}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <Text style={styles.noMatch}>
                {loading || failed ? 'No matches in the concepts loaded so far.' : 'No saved concepts match your search.'}
              </Text>
            }
            renderItem={({ item }) => (
              <CollectionConceptRow
                title={item.title}
                category={item.topicName}
                likes={item.likes}
                onPress={() =>
                  navigation.navigate('ConceptDetail', { conceptId: item.id, title: item.title })
                }
                accessibilityLabel={`Open ${item.title}`}
                trailing={<Ionicons name="bookmark" size={scaleIcon(16)} color={colors.primary} />}
              />
            )}
          />
        </>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.md,
    },
    iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    title: { ...typography.title, fontSize: scaleFont(20), color: colors.text },
    loadStatus: { padding: spacing.md, gap: spacing.sm, alignItems: 'center' },
    searchWrap: {
      marginHorizontal: spacing.lg,
    },
    filterRow: { flexGrow: 0, marginTop: spacing.sm },
    filterContent: { paddingHorizontal: spacing.lg, paddingVertical: spacing.xs, gap: spacing.sm },
    filterChip: {
      minHeight: 44,
      justifyContent: 'center',
      paddingHorizontal: spacing.md,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    filterChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
    filterText: { fontSize: scaleFont(13), lineHeight: scaleFont(18), fontWeight: '600', color: colors.textSecondary },
    filterTextActive: { color: colors.onPrimary },
    listContent: { padding: spacing.lg, paddingTop: spacing.md },
    noMatch: { fontSize: scaleFont(14), color: colors.textMuted, textAlign: 'center', marginTop: spacing.lg },
    empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    emptyTitle: { fontSize: scaleFont(17), fontWeight: '700', color: colors.text },
    emptyText: { fontSize: scaleFont(14), color: colors.textMuted, textAlign: 'center' },
  });
