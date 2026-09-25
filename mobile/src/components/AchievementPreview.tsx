import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAchievements } from '../context/AchievementsContext';
import { useTheme } from '../context/ThemeContext';
import { nextMilestone } from '../services/achievementStore';
import { radius, scaleFont, spacing } from '../theme';
import { AchievementBadge } from './AchievementBadge';

export function AchievementPreview({ onPress }: { onPress: () => void }) {
  const { snapshot, loading, failed } = useAchievements();
  const { colors } = useTheme();
  const collection = snapshot?.collection ?? null;
  const earned = collection?.items.filter(a => a.earned_on) ?? [];
  const next = nextMilestone(collection);
  return <Pressable accessibilityRole="button" accessibilityLabel="Open achievements" onPress={onPress}
    style={({ pressed }) => [styles.card, { backgroundColor: colors.surface, borderColor: colors.border, opacity: pressed ? 0.8 : 1 }]}>
    <View style={styles.heading}>
      <Text style={[styles.title, { color: colors.text }]}>Achievements</Text>
      <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
    </View>
    <Text style={[styles.copy, { color: colors.textSecondary }]}>
      {collection ? `${earned.length} of ${collection.items.length} earned · Yours to keep` : loading ? 'Loading your collection…' : failed ? 'Open to retry loading your collection' : 'Celebrate your consistency'}
    </Text>
    <View style={styles.badges}>
      {(earned.length ? earned.slice(-3) : collection?.items.slice(0, 3) ?? []).map(a =>
        <AchievementBadge key={a.code} artwork={a.artwork_key} locked={!a.earned_on} size={52} />)}
    </View>
    {next && <Text style={[styles.copy, { color: colors.textSecondary }]}>
      Next milestone: {Math.min(collection!.current_streak, next.threshold)} of {next.threshold.toLocaleString()} days
    </Text>}
    {collection && !next && <Text style={[styles.copy, { color: colors.textSecondary }]}>Every streak milestone earned. Keep your curiosity going.</Text>}
  </Pressable>;
}
const styles = StyleSheet.create({
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, padding: spacing.md, gap: spacing.sm },
  heading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { fontSize: scaleFont(18), fontWeight: '700' },
  copy: { fontSize: scaleFont(13), lineHeight: scaleFont(19) },
  badges: { flexDirection: 'row', gap: spacing.sm },
});
