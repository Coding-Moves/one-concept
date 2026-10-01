import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Surface } from '../components/Surface';
import { UnavailableState } from '../components/UnavailableState';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { ProfileStackParamList } from './ProfileScreen';
import { getSubtopicProgress, SubtopicProgress } from '../services/subtopicProgressApi';
import { radius, scaleFont, scaleIcon, spacing, ThemeColors, typography } from '../theme';

/** Optional quizzes remain separate from the daily learning flow. */
export function SubtopicQuizzesScreen() {
  const { session } = useAuth();
  const online = useOnline();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'SubtopicQuizzes'>>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = session?.user.id;
  const [items, setItems] = useState<SubtopicProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true); setError(null);
    try { setItems(await getSubtopicProgress(userId)); }
    catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  const completed = items.filter(item => item.completed && item.completion_id);

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <ScreenHeader eyebrow="Optional deeper practice" title="Learning path quizzes" subtitle="Use reviewed questions to revisit a path you have completed. Daily learning stays independent." />
    {loading ? <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.muted}>Checking your completed paths…</Text></View> : null}
    {!loading && error ? <UnavailableState offline={!online} error={error} message="Your optional quizzes are still here. Connect and try again." onRetry={load} /> : null}
    {!loading && !error && completed.length === 0 ? <Surface tone="subtle" style={styles.empty}>
      <Ionicons name="layers-outline" size={scaleIcon(26)} color={colors.primary} />
      <Text style={styles.cardTitle}>Complete a learning path first</Text>
      <Text style={styles.copy}>When every current concept in a subtopic is complete, an optional quiz can be prepared here.</Text>
      <PrimaryButton label="Check again" onPress={load} />
    </Surface> : null}
    {!loading && !error ? completed.map(item => <Pressable
      key={item.completion_id}
      onPress={() => navigation.navigate('SubtopicQuiz', {
        completionId: item.completion_id!, topicName: item.topic_name, subtopicName: item.subtopic_name,
      })}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      accessibilityRole="button"
      accessibilityLabel={`Open optional quiz for ${item.subtopic_name}`}
    >
      <View style={styles.rowLeft}>
        <Ionicons name="help-circle-outline" size={scaleIcon(21)} color={colors.primary} />
        <View style={styles.rowText}>
          <Text style={styles.rowTitle}>{item.subtopic_name}</Text>
          <Text style={styles.rowSubtitle}>{item.topic_name} · {item.completed_concepts} concepts completed</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={scaleIcon(20)} color={colors.textMuted} />
    </Pressable>) : null}
  </ScrollView>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  muted: { color: colors.textMuted, fontSize: scaleFont(15) },
  empty: { alignItems: 'flex-start', gap: spacing.md },
  cardTitle: { ...typography.heading, color: colors.text },
  copy: { color: colors.textSecondary, fontSize: scaleFont(15), lineHeight: scaleFont(22) },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.md },
  rowPressed: { backgroundColor: colors.surfaceSubtle },
  rowLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flex: 1 },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { color: colors.text, fontWeight: '700', fontSize: scaleFont(16) },
  rowSubtitle: { color: colors.textMuted, fontSize: scaleFont(13) },
});
