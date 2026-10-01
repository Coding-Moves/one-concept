import { RouteProp, useRoute } from '@react-navigation/native';
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
import {
  fetchSubtopicQuiz,
  fetchSubtopicQuizHistory,
  SubtopicQuiz,
  SubtopicQuizAttempt,
  SubtopicQuizAttemptSummary,
  SubtopicQuizUnavailable,
  submitSubtopicQuiz,
} from '../services/subtopicQuizApi';
import { radius, scaleFont, spacing, ThemeColors, typography } from '../theme';

type QuizRoute = RouteProp<ProfileStackParamList, 'SubtopicQuiz'>;

export function SubtopicQuizScreen() {
  const { session } = useAuth();
  const online = useOnline();
  const { completionId, topicName, subtopicName } = useRoute<QuizRoute>().params;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = session?.user.id;
  const [quiz, setQuiz] = useState<SubtopicQuiz | null>(null);
  const [unavailable, setUnavailable] = useState<SubtopicQuizUnavailable | null>(null);
  const [history, setHistory] = useState<SubtopicQuizAttemptSummary[]>([]);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState<SubtopicQuizAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true); setError(null); setAttempt(null); setAnswers({});
    try {
      const [response, past] = await Promise.all([
        fetchSubtopicQuiz(userId, completionId), fetchSubtopicQuizHistory(userId, completionId),
      ]);
      setHistory(Array.isArray(past.items) ? past.items : []);
      if (response.available) { setQuiz(response); setUnavailable(null); }
      else { setQuiz(null); setUnavailable(response); }
    } catch (cause) { setError(cause); }
    finally { setLoading(false); }
  }, [completionId, userId]);

  useEffect(() => { void load(); }, [load]);
  const complete = !!quiz && quiz.questions.every(question => answers[question.id] != null);
  const choose = (questionId: string, option: number) => {
    if (!attempt) setAnswers(current => ({ ...current, [questionId]: option }));
  };
  const submit = async () => {
    if (!quiz || !complete || !userId || submitting) return;
    setSubmitting(true); setError(null);
    try {
      const next = await submitSubtopicQuiz(userId, quiz.quiz_id, quiz.questions.map(question => ({
        question_id: question.id, selected_index: answers[question.id],
      })));
      setAttempt(next);
      setHistory(current => [{
        attempt_id: next.attempt_id, attempted_at: next.attempted_at,
        correct_count: next.correct_count, question_count: next.question_count,
      }, ...current]);
    } catch (cause) { setError(cause); }
    finally { setSubmitting(false); }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <ScreenHeader eyebrow="Optional learning check" title={subtopicName} subtitle={`${topicName} · Your daily learning and streak are unaffected.`} />
    {loading ? <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.muted}>Preparing reviewed questions…</Text></View> : null}
    {!loading && error ? <UnavailableState offline={!online} error={error} message="This optional quiz could not load. Connect and try again." onRetry={load} /> : null}
    {!loading && unavailable ? <Surface tone="subtle" style={styles.unavailable}>
      <Text style={styles.cardTitle}>Quiz preparation in progress</Text>
      <Text style={styles.copy}>{unavailable.detail}</Text>
      <Text style={styles.progress}>{unavailable.reviewed_concepts} of {unavailable.required_concepts} reviewed concepts ready</Text>
      <PrimaryButton label="Check again" onPress={load} />
    </Surface> : null}
    {!loading && quiz ? <>
      {attempt ? <Surface style={styles.result}>
        <Text accessibilityRole="header" style={styles.score}>{attempt.correct_count} / {attempt.question_count} correct</Text>
        <Text style={styles.copy}>Your result is saved. You can retry this same reviewed quiz whenever you want.</Text>
        <PrimaryButton label="Try again" onPress={() => { setAttempt(null); setAnswers({}); }} />
      </Surface> : null}
      {quiz.questions.map((question, position) => {
        const result = attempt?.results.find(item => item.question_id === question.id);
        return <Surface key={question.id} style={styles.question}>
          <Text style={styles.eyebrow}>Question {position + 1} · {question.concept_title}</Text>
          <Text style={styles.questionText}>{question.question}</Text>
          {question.options.map((option, index) => {
            const selected = answers[question.id] === index;
            const correct = result?.correct_index === index;
            const wrong = !!result && selected && !result.correct;
            return <Pressable key={`${question.id}-${index}`} disabled={!!attempt} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !!attempt }} onPress={() => choose(question.id, index)} style={[styles.option, selected && styles.selected, correct && styles.correct, wrong && styles.wrong]}>
              <Text style={[styles.optionText, (selected || correct) && styles.optionSelected]}>{option}</Text>
            </Pressable>;
          })}
        </Surface>;
      })}
      {!attempt ? <PrimaryButton label={submitting ? 'Scoring…' : complete ? 'Submit answers' : `Answer all (${Object.keys(answers).length}/${quiz.questions.length})`} onPress={submit} disabled={!complete || submitting} /> : null}
    </> : null}
    {!loading && history.length > 0 ? <Surface tone="subtle" style={styles.history}>
      <Text style={styles.cardTitle}>Previous attempts</Text>
      {history.map(item => <Text key={item.attempt_id} style={styles.historyItem}>{item.correct_count} / {item.question_count} correct · {new Date(item.attempted_at).toLocaleDateString()}</Text>)}
    </Surface> : null}
  </ScrollView>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.lg },
  loading: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.md },
  muted: { color: colors.textMuted, fontSize: scaleFont(15) },
  unavailable: { gap: spacing.md },
  cardTitle: { ...typography.heading, color: colors.text },
  copy: { color: colors.textSecondary, fontSize: scaleFont(15), lineHeight: scaleFont(22) },
  progress: { color: colors.primary, fontWeight: '700', fontSize: scaleFont(15) },
  result: { gap: spacing.md },
  score: { ...typography.title, color: colors.primary },
  question: { gap: spacing.md },
  eyebrow: { color: colors.textMuted, fontSize: scaleFont(12), fontWeight: '700', letterSpacing: 0.7, textTransform: 'uppercase' },
  questionText: { ...typography.heading, fontSize: scaleFont(18), color: colors.text },
  option: { minHeight: 44, justifyContent: 'center', borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  selected: { backgroundColor: colors.categoryChip },
  correct: { backgroundColor: colors.successSurface },
  wrong: { backgroundColor: colors.dangerSurface },
  optionText: { color: colors.textSecondary, fontSize: scaleFont(15), lineHeight: scaleFont(21) },
  optionSelected: { color: colors.text, fontWeight: '700' },
  history: { gap: spacing.sm },
  historyItem: { color: colors.textSecondary, fontSize: scaleFont(14) },
});
