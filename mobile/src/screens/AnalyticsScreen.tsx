import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { SkeletonBlock } from '../components/Skeleton';
import { Surface } from '../components/Surface';
import { UnavailableState } from '../components/UnavailableState';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useRefreshControl } from '../hooks/useRefreshControl';
import { getLearningAnalytics, LearningAnalytics, quizAccuracy } from '../services/analyticsApi';
import { radius, scaleFont, spacing, ThemeColors, typography } from '../theme';
import { useTheme } from '../context/ThemeContext';

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function activityDayLabel(day: string) {
  const [year, month, date] = day.split('-').map(Number);
  const monthName = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][month - 1];
  return Number.isInteger(year) && monthName && Number.isInteger(date) ? `${monthName} ${date}` : day;
}

export function AnalyticsScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const online = useOnline();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [analytics, setAnalytics] = useState<LearningAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!session?.user.id) return;
    setError(null);
    try {
      setAnalytics(await getLearningAnalytics(session.user.id));
    } catch (reason) {
      setError(reason);
    } finally {
      setLoading(false);
    }
  }, [session?.user.id]);

  useEffect(() => {
    setAnalytics(null);
    setLoading(true);
    void load();
  }, [load]);

  const refreshUI = useRefreshControl('analytics', load);
  const accuracy = analytics ? quizAccuracy(analytics.correct_answers, analytics.answered_questions) : null;
  const recentActivity = analytics?.activity.slice(-7) ?? [];
  const earned = analytics?.achievements.filter((achievement) => achievement.earned_on).length ?? 0;
  const completedSubtopics = analytics?.subtopics.filter((subtopic) => subtopic.completed).length ?? 0;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={refreshUI.control}>
      {refreshUI.action}
      <View style={styles.top}>
        <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={styles.back}>
          <Ionicons name="arrow-back" size={24} color={colors.text} />
        </Pressable>
        <View style={styles.header}>
          <ScreenHeader
            eyebrow="Your learning"
            title="Activity analytics"
            subtitle="A private summary of progress accepted by your account."
          />
        </View>
      </View>

      {loading ? <>
        <SkeletonBlock style={{ height: 96, borderRadius: radius.lg }} />
        <SkeletonBlock style={{ height: 200, borderRadius: radius.lg }} />
      </> : null}

      {!loading && !analytics && error ? (
        <UnavailableState offline={!online} error={error} message="Connect to load your learning analytics." onRetry={load} />
      ) : null}

      {!loading && analytics ? <>
        <View style={styles.metrics}>
          <Metric label="Concepts learned" value={analytics.total_concepts} />
          <Metric label="Reviews completed" value={analytics.total_reviews} />
          <Metric label="Active days" value={`${analytics.active_days} / 28`} />
          <Metric label="Current streak" value={plural(analytics.current_streak, 'day')} />
        </View>

        {analytics.total_concepts === 0 && analytics.total_reviews === 0 && analytics.weekly_quiz_attempts === 0 ? (
          <Surface tone="subtle" style={styles.card}>
            <Text style={styles.cardTitle}>Your learning story starts here</Text>
            <Text style={styles.copy}>Complete a concept, review it later, or try an optional quiz. This page will update after the server accepts that activity.</Text>
          </Surface>
        ) : null}

        <Text style={styles.sectionLabel}>Recent activity</Text>
        <Surface style={styles.card}>
          {recentActivity.map((day) => {
            const count = day.concepts + day.reviews + day.quizzes;
            return <View key={day.day} style={styles.activityRow}>
              <Text style={styles.rowName}>{activityDayLabel(day.day)}</Text>
              <Text style={styles.rowValue}>{count === 0 ? 'No activity' : `${plural(day.concepts, 'concept')} · ${plural(day.reviews, 'review')} · ${plural(day.quizzes, 'quiz')}`}</Text>
            </View>;
          })}
          <Text style={styles.note}>Last 7 days · grouped in your account time zone</Text>
        </Surface>

        <Text style={styles.sectionLabel}>Quiz performance</Text>
        <Surface style={styles.card}>
          <View style={styles.summaryRow}>
            <Text style={styles.cardTitle}>{accuracy == null ? 'No quiz attempts yet' : `${accuracy}% correct`}</Text>
            <Text style={styles.rowValue}>{plural(analytics.weekly_quiz_attempts, 'attempt')}</Text>
          </View>
          <Text style={styles.copy}>{accuracy == null ? 'Optional weekly quizzes will appear here after your first attempt.' : `${analytics.correct_answers} correct answers from ${analytics.answered_questions} questions.`}</Text>
          {analytics.recent_quizzes.map((quiz) => <View key={quiz.attempted_at} style={styles.activityRow}>
            <Text style={styles.rowName}>Week of {quiz.week_start}</Text>
            <Text style={styles.rowValue}>{quiz.correct_count} / {quiz.question_count} correct</Text>
          </View>)}
        </Surface>

        <Text style={styles.sectionLabel}>Topics and learning paths</Text>
        <Surface style={styles.card}>
          {analytics.topics.length === 0 ? <Text style={styles.copy}>Learn a concept to see your topic distribution.</Text> : analytics.topics.map((topic) => <View key={topic.topic_slug} style={styles.activityRow}>
            <Text style={styles.rowName}>{topic.topic_name}</Text>
            <Text style={styles.rowValue}>{plural(topic.completed_concepts, 'concept')}</Text>
          </View>)}
          <Text style={styles.note}>{completedSubtopics} of {analytics.subtopics.length} learning paths complete</Text>
        </Surface>

        <Text style={styles.sectionLabel}>Collection</Text>
        <Surface style={styles.card}>
          <Text style={styles.cardTitle}>{earned} / {analytics.achievements.length} achievements earned</Text>
          <Text style={styles.copy}>Your best streak is {plural(analytics.longest_streak, 'day')}. Achievements are confirmed when the server records your learning activity.</Text>
          {analytics.recent_concepts.length > 0 ? <>
            <Text style={styles.note}>Recently learned</Text>
            {analytics.recent_concepts.map((concept) => <View key={`${concept.concept_slug}-${concept.completed_at}`} style={styles.activityRow}>
              <Text style={styles.rowName}>{concept.title}</Text>
              <Text style={styles.rowValue}>{concept.topic_name}</Text>
            </View>)}
          </> : null}
        </Surface>
      </> : null}
    </ScrollView>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  const { colors } = useTheme();
  return <Surface style={styles.metric}>
    <Text style={[styles.metricValue, { color: colors.text }]}>{value}</Text>
    <Text style={[styles.metricLabel, { color: colors.textMuted }]}>{label}</Text>
  </Surface>;
}

const styles = StyleSheet.create({
  metric: { flex: 1, minWidth: 145, gap: spacing.xs },
  metricValue: { fontSize: scaleFont(18), fontWeight: '700' },
  metricLabel: { fontSize: scaleFont(12) },
});

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.xs },
  back: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  header: { flex: 1, paddingTop: spacing.xs },
  card: { gap: spacing.md },
  cardTitle: { ...typography.heading, fontSize: scaleFont(18), color: colors.text },
  copy: { fontSize: scaleFont(14), lineHeight: scaleFont(21), color: colors.textSecondary },
  sectionLabel: { fontSize: scaleFont(13), fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', color: colors.textMuted, marginBottom: -spacing.sm },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  activityRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.md },
  rowName: { flex: 1, fontSize: scaleFont(14), fontWeight: '600', color: colors.text },
  rowValue: { flexShrink: 1, textAlign: 'right', fontSize: scaleFont(12), color: colors.textMuted },
  note: { fontSize: scaleFont(12), color: colors.textMuted },
});
