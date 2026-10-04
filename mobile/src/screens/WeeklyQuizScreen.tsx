import { useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ApiError } from '../api/client';
import { PrimaryButton } from '../components/PrimaryButton';
import { ScreenHeader } from '../components/ScreenHeader';
import { Surface } from '../components/Surface';
import { MarkdownText, markdownPlainText } from '../components/MarkdownText';
import { UnavailableState } from '../components/UnavailableState';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { WeeklyQuiz, WeeklyQuizAttempt, fetchWeeklyQuiz, submitWeeklyQuiz } from '../services/weeklyQuizApi';
import { radius, scaleFont, spacing, ThemeColors, typography } from '../theme';

/** A server-frozen weekly quiz: questions never include answer keys until submitted. */
export function WeeklyQuizScreen() {
  const { session } = useAuth();
  const route = useRoute();
  const notificationRequestId = (route.params as { notificationRequestId?: string } | undefined)?.notificationRequestId;
  const online = useOnline();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const userId = session?.user.id;
  const [quiz, setQuiz] = useState<WeeklyQuiz | null>(null);
  const [unavailable, setUnavailable] = useState<{ detail: string; available: number; required: number } | null>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [attempt, setAttempt] = useState<WeeklyQuizAttempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    if (!userId) return;
    const generation = ++loadGeneration.current;
    setLoading(true); setError(null); setQuiz(null); setUnavailable(null); setAttempt(null); setAnswers({});
    try {
      const response = await fetchWeeklyQuiz(userId);
      if (generation !== loadGeneration.current) return;
      if (response.available) { setQuiz(response); setUnavailable(null); }
      else { setQuiz(null); setUnavailable({ detail: response.detail, available: response.available_concepts, required: response.required_concepts }); }
    } catch (cause) { if (generation === loadGeneration.current) setError(cause); }
    finally { if (generation === loadGeneration.current) setLoading(false); }
  }, [userId]);

  useEffect(() => { void load(); return () => { loadGeneration.current++; }; }, [load, notificationRequestId]);

  const choose = (questionId: string, option: number) => {
    if (attempt) return;
    setAnswers(current => ({ ...current, [questionId]: option }));
  };
  const complete = !!quiz && quiz.questions.every(question => answers[question.id] != null);
  const submit = async () => {
    if (!quiz || !complete || submitting || !userId) return;
    const generation = loadGeneration.current;
    setSubmitting(true); setError(null);
    try {
      const result = await submitWeeklyQuiz(userId, quiz.quiz_id, quiz.questions.map(question => ({ question_id: question.id, selected_index: answers[question.id] })));
      if (generation === loadGeneration.current) setAttempt(result);
    }
    catch (cause) { if (generation === loadGeneration.current) setError(cause); }
    finally { setSubmitting(false); }
  };

  return <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
    <ScreenHeader eyebrow="Optional weekly check-in" title="Weekly quiz" subtitle="One reviewed question from seven concepts you completed." />
    {loading ? <View style={styles.loading}><ActivityIndicator size="large" color={colors.primary} /><Text style={styles.muted}>Preparing your quiz…</Text></View> : null}
    {!loading && error ? <UnavailableState offline={!online} error={error} message="Your weekly quiz is still waiting for you. Connect and try again." onRetry={load} /> : null}
    {!loading && unavailable ? <Surface tone="subtle" style={styles.unavailable}>
      <Text style={styles.cardTitle}>Keep learning to unlock it</Text>
      <Text style={styles.copy}>{unavailable.detail}</Text>
      <Text style={styles.progress}>{unavailable.available} of {unavailable.required} reviewed concepts completed</Text>
      <PrimaryButton label="Check again" onPress={load} />
    </Surface> : null}
    {!loading && quiz ? <>
      {attempt ? <Surface style={styles.result}>
        <Text accessibilityRole="header" style={styles.score}>{attempt.correct_count} / 7 correct</Text>
        <Text style={styles.copy}>Your result is saved. You can try the same frozen weekly quiz again whenever you want.</Text>
        <PrimaryButton label="Try again" onPress={() => { setAttempt(null); setAnswers({}); }} />
      </Surface> : null}
      {quiz.questions.map((question, position) => {
        const result = attempt?.results.find(item => item.question_id === question.id);
        return <Surface key={question.id} style={styles.question}>
          <Text style={styles.eyebrow}>Question {position + 1} · <MarkdownText value={question.concept_title} style={styles.eyebrow} inline /></Text>
          <MarkdownText value={question.question} style={styles.questionText} />
          <View accessibilityRole="radiogroup" accessibilityLabel={`Answers for question ${position + 1}`} style={styles.options}>
            {question.options.map((option, index) => {
              const selected = answers[question.id] === index;
              const correct = result?.correct_index === index;
              const wrong = !!result && selected && !result.correct;
              const icon = correct ? 'checkmark' : wrong ? 'close' : selected ? 'ellipse' : 'ellipse-outline';
              return <Pressable key={option} disabled={!!attempt} accessibilityRole="radio" accessibilityState={{ checked: selected, disabled: !!attempt }} accessibilityLabel={markdownPlainText(option)} accessibilityHint={attempt ? (correct ? 'Correct answer.' : wrong ? 'Your selected answer was incorrect.' : 'Answer was not selected.') : 'Select this answer.'} onPress={() => choose(question.id, index)} style={[styles.option, selected && styles.selected, correct && styles.correct, wrong && styles.wrong]}>
                <View style={[styles.radioMarker, selected && styles.radioMarkerSelected, correct && styles.radioMarkerCorrect, wrong && styles.radioMarkerWrong]}>
                  <Ionicons name={icon} size={scaleFont(16)} color={correct ? colors.success : wrong ? colors.danger : selected ? colors.quizAccent : colors.textMuted} />
                </View>
                <MarkdownText value={option} style={[styles.optionText, (selected || correct) && styles.optionSelected]} inline interactiveLinks={false} />
              </Pressable>;
            })}
          </View>
        </Surface>;
      })}
      {!attempt ? <PrimaryButton label={submitting ? 'Scoring…' : complete ? 'Submit answers' : `Answer all 7 (${Object.keys(answers).length}/7)`} onPress={submit} disabled={!complete || submitting} /> : null}
    </> : null}
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
  options: { gap: spacing.sm },
  option: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, borderRadius: radius.md, backgroundColor: colors.surfaceSubtle, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  selected: { backgroundColor: colors.quizAccentSurface },
  correct: { backgroundColor: colors.successSurface },
  wrong: { backgroundColor: colors.dangerSurface },
  radioMarker: { width: scaleFont(22), height: scaleFont(22), borderRadius: scaleFont(11), alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface },
  radioMarkerSelected: { backgroundColor: colors.quizAccentSurface },
  radioMarkerCorrect: { backgroundColor: colors.successSurface },
  radioMarkerWrong: { backgroundColor: colors.dangerSurface },
  optionText: { color: colors.textSecondary, fontSize: scaleFont(15), lineHeight: scaleFont(21) },
  optionSelected: { color: colors.text, fontWeight: '700' },
});
