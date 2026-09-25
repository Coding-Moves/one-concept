import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { AchievementBadge } from '../components/AchievementBadge';
import { AchievementDetail } from '../components/AchievementDetail';
import { useAchievements } from '../context/AchievementsContext';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { useRefreshControl } from '../hooks/useRefreshControl';
import { nextMilestone } from '../services/achievementStore';
import { radius, scaleFont, spacing, typography } from '../theme';

export function AchievementsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { snapshot, loading, failed, fresh, refresh } = useAchievements();
  const { colors } = useTheme();
  const online = useOnline();
  const { width, fontScale } = useWindowDimensions();
  const columns = width < 340 || fontScale > 1.3 ? 1 : 2;
  const refreshUI = useRefreshControl('achievements', refresh);
  const [selected, setSelected] = useState<string | null>(null);
  const collection = snapshot?.collection;
  const next = nextMilestone(collection ?? null);
  const earned = collection?.items.filter(a => a.earned_on).length ?? 0;
  const award = collection?.items.find(a => a.code === selected && a.earned_on);
  return <View style={[styles.screen, { backgroundColor: colors.background }]}>
    <View style={[styles.top, { paddingTop: insets.top + spacing.sm }]}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.back}>
        <Ionicons name="arrow-back" size={24} color={colors.text} />
      </Pressable>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>Achievements</Text>
    </View>
    <FlatList key={columns} numColumns={columns} data={collection?.items ?? []} keyExtractor={a => a.code}
      contentContainerStyle={styles.list} columnWrapperStyle={columns === 2 ? { gap: spacing.md } : undefined}
      refreshControl={refreshUI.control}
      ListHeaderComponent={<View style={styles.header}>
        <Text style={[styles.lead, { color: colors.text }]}>Small steps. Lasting achievements.</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Keep learning one day at a time. Every badge you earn stays in your collection.</Text>
        {collection && <>
          <View style={[styles.summary, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <Text style={[styles.number, { color: colors.text }]}>{earned} / {collection.items.length} earned</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Current streak {collection.current_streak} days · Best {collection.longest_streak} days</Text>
            {next ? <>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>Next milestone · {next.threshold.toLocaleString()} days</Text>
              <View accessibilityRole="progressbar" accessibilityLabel="Next streak milestone"
                accessibilityValue={{ min: 0, max: next.threshold, now: Math.min(collection.current_streak, next.threshold) }}
                style={[styles.track, { backgroundColor: colors.border }]}>
                <View style={[styles.fill, { backgroundColor: colors.primary, width: `${Math.min(100, 100 * collection.current_streak / next.threshold)}%` }]} />
              </View>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>{Math.max(0, next.threshold - collection.current_streak).toLocaleString()} more consecutive days</Text>
            </> : <Text style={[styles.copy, { color: colors.textSecondary }]}>All streak milestones earned.</Text>}
          </View>
          {(!online || !fresh) && <Text accessibilityLiveRegion="polite" style={[styles.copy, { color: colors.textSecondary }]}>Saved achievements. Connect and sync to confirm new milestones.</Text>}
        </>}
        {refreshUI.action}
        {failed && <Text accessibilityRole="alert" style={[styles.copy, { color: colors.textSecondary }]}>Couldn’t refresh achievements. Your saved collection is still available. Try again when connected.</Text>}
      </View>}
      ListEmptyComponent={loading ? <ActivityIndicator accessibilityLabel="Loading achievements" color={colors.primary} /> :
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Your collection will appear here after a successful sync.</Text>}
      renderItem={({ item }) => {
        const unlocked = Boolean(item.earned_on);
        const body = <>
          <AchievementBadge artwork={item.artwork_key} locked={!unlocked} />
          <Text style={[styles.badgeTitle, { color: colors.text }]}>{unlocked ? item.name : `${item.threshold.toLocaleString()} days`}</Text>
          <Text style={[styles.caption, { color: colors.textSecondary }]}>{unlocked ? `${item.threshold.toLocaleString()} days · Earned` : 'Keep learning to reveal'}</Text>
        </>;
        const cardStyle = [styles.tile, { backgroundColor: colors.surface, borderColor: unlocked ? colors.primary + '60' : colors.border }];
        return unlocked ? <Pressable accessibilityRole="button" accessibilityLabel={`${item.name}, ${item.threshold} day achievement, earned`}
          onPress={() => setSelected(item.code)} style={({ pressed }) => [...cardStyle, { opacity: pressed ? 0.8 : 1 }]}>{body}</Pressable> :
          <View accessible accessibilityLabel={`${item.threshold} day achievement, locked`} style={cardStyle}>{body}</View>;
      }}
    />
    {award && <AchievementDetail award={award} onClose={() => setSelected(null)} />}
  </View>;
}
const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  title: { ...typography.title, fontSize: scaleFont(24), flexShrink: 1 },
  list: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  header: { gap: spacing.md, marginBottom: spacing.md },
  lead: { ...typography.title, fontSize: scaleFont(24) },
  copy: { fontSize: scaleFont(14), lineHeight: scaleFont(21) },
  summary: { borderWidth: 1, borderRadius: radius.lg, padding: spacing.md, gap: spacing.sm },
  number: { fontSize: scaleFont(20), fontWeight: '700' },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  tile: { flex: 1, padding: spacing.md, borderWidth: 1, borderRadius: radius.lg, alignItems: 'center', gap: spacing.sm, maxWidth: '100%' },
  badgeTitle: { fontSize: scaleFont(17), fontWeight: '700', textAlign: 'center' },
  caption: { fontSize: scaleFont(12), textAlign: 'center', lineHeight: scaleFont(18) },
});
