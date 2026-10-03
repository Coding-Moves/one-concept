import { useRefreshControl } from '../hooks/useRefreshControl';
import { useNavigation, NavigationProp, NavigatorScreenParams } from '@react-navigation/native';
import type { ProfileStackParamList } from './ProfileScreen';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConceptActions } from '../components/ConceptActions';
import { ConceptCard } from '../components/ConceptCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { SkeletonBlock, SkeletonConceptCard } from '../components/Skeleton';
import { SubtopicCompletionCard } from '../components/SubtopicCompletionCard';
import { ScreenHeader } from '../components/ScreenHeader';
import { StreakBadge } from '../components/StreakBadge';
import { UnavailableState } from '../components/UnavailableState';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { toConcept } from '../services/dailyApi';
import { greetingFor } from '../services/greeting';
import { scaleIcon, scaleFont, radius, shadows, spacing, ThemeColors } from '../theme';

export function TodayScreen() {
  const {
    loading: localLoading,
    concept: localConcept,
    serverDaily,
    hasLearned,
    learnedToday,
    streaks,
    progress,
    markLearned,
    completeReview,
    refresh,
  } = useProgress();
  const { session } = useAuth();
  const online = useOnline();
  const { colors, mode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const refreshUI = useRefreshControl('today', refresh);

  const navigation = useNavigation<NavigationProp<{Profile: NavigatorScreenParams<ProfileStackParamList>}>>();
  const explore = () => navigation.navigate('Profile', {screen: 'Personalization'});
  const outcome = serverDaily;
  const review = outcome?.status === 'review';
  // An authenticated user can read a cached assignment, never an invented demo lesson.
  const serverConcept =
    outcome && (outcome.status === 'ok' || outcome.status === 'review') ? toConcept(outcome.payload) : null;
  const concept = serverConcept ?? (session ? null : localConcept);

  // The shown concept is done if today's date is marked (the instant
  // optimistic signal) OR the *server* concept is in the learned set — the
  // latter survives a cross-midnight completion the server counts against
  // yesterday, so the button does not wrongly re-arm (issue #53). Only the
  // server concept qualifies: the local fallback (selectDailyConcept) can
  // recycle an already-learned concept once the bundled pool is exhausted,
  // and that must still show the button.
  const done = review ? outcome.payload.learned : learnedToday || (!!serverConcept && hasLearned(serverConcept.id));
  const loading = localLoading;
  const exhausted = outcome?.status === 'exhausted';
  const personalizationRequired = outcome?.status === 'personalization_required';
  const greeting = greetingFor(new Date(), progress.timezone, progress.displayName);
  const offline = (outcome?.status === 'ok'
    || outcome?.status === 'review'
    || outcome?.status === 'personalization_required') && outcome.stale;
  const outsideTopics =
    outcome?.status === 'ok' && outcome.payload.outside_followed_topics;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={refreshUI.control}>
      {refreshUI.action}
      <ScreenHeader
        eyebrow="Daily learning"
        title={greeting}
        large
        subtitle="One day. One concept. One small step forward."
        action={(
          <Pressable
            onPress={toggle}
            style={({ pressed }) => [styles.themeButton, pressed && styles.themeButtonPressed]}
            accessibilityRole="button"
            accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Ionicons
              name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
              size={scaleIcon(20)}
              color={colors.textSecondary}
            />
          </Pressable>
        )}
      />

      {loading ? (
        <>
          <SkeletonBlock style={{ width: '100%', height: 64, borderRadius: radius.md }} />
          <Text style={styles.sectionLabel}>{review ? "Today’s review" : "Today’s concept"}</Text>
          <SkeletonConceptCard />
          <SkeletonBlock style={{ width: '100%', height: 50, borderRadius: radius.md }} />
        </>
      ) : (
        <>
          <StreakBadge streaks={streaks} />

          <Text style={styles.sectionLabel}>
            {personalizationRequired ? 'Your learning plan' : review ? "Today’s review" : "Today’s concept"}
          </Text>

          {offline ? (
            <View style={styles.offlineRow}>
              <Ionicons name="cloud-offline-outline" size={scaleIcon(13)} color={colors.textMuted} />
              <Text style={styles.offlineText}>
                {personalizationRequired ? 'Offline — showing your last saved plan' : 'Offline — showing your saved copy'}
              </Text>
            </View>
          ) : null}

          {outsideTopics ? (
            <View style={styles.noteBox}>
              <Ionicons name="sparkles-outline" size={scaleIcon(16)} color={colors.textMuted} />
              <Text style={styles.noteText}>
                You’ve read everything in your topics, so here’s one from further afield.
              </Text>
            </View>
          ) : null}

          {exhausted ? (
            <View style={styles.noteBox}>
              <Ionicons name="checkmark-done-outline" size={scaleIcon(16)} color={colors.success} />
              <Text style={styles.noteText}>
                No new lesson is available for you right now. Complete a lesson to build your review library, or explore the subjects.
              </Text>
            </View>
          ) : null}

          {review ? (
            <View style={styles.noteBox}>
              <Ionicons name="refresh-outline" size={scaleIcon(18)} color={colors.textSecondary} />
              <Text style={styles.noteText}>
                Review a previous lesson. Recall the idea before rereading, then explain the example in your own words. Completing this review counts toward your streak.
              </Text>
            </View>
          ) : null}

          {personalizationRequired ? (
            <View
              style={styles.personalizationBox}
              accessibilityLabel="Choose one or more topics to receive your next daily concept."
            >
              <View style={styles.personalizationIcon}>
                <Ionicons name="compass-outline" size={scaleIcon(24)} color={colors.primary} />
              </View>
              <Text style={styles.personalizationTitle}>Choose what you want to learn</Text>
              <Text style={styles.personalizationText}>
                Follow one or more topics to shape your next daily concept. Your previous lessons and streak stay safe.
              </Text>
              <PrimaryButton label="Choose topics" onPress={explore} />
            </View>
          ) : concept ? (
            <>
              <ConceptCard concept={concept} />
              <ConceptActions concept={concept} />
            </>
          ) : !exhausted ? (
            <UnavailableState
              offline={!online}
              message="Today’s concept isn’t available on this device yet. Connect and try again."
              onRetry={refresh}
            />
          ) : null}

          {concept && (done ? (
            <>
              <View style={styles.doneBox}>
                <Ionicons name="checkmark-circle" size={scaleIcon(20)} color={colors.success} />
                <Text style={styles.doneText}>{review ? "Review complete — your learning day counts." : "Learned today — see you tomorrow!"}</Text>
              </View>
              {!review && progress.recentSubtopicCompletion ? <SubtopicCompletionCard completion={progress.recentSubtopicCompletion} /> : null}
            </>
          ) : personalizationRequired ? null : (
            <PrimaryButton
              label={review ? "Complete review" : "Mark as learned"}
              onPress={() => review ? completeReview(outcome.payload.review_id) : markLearned(concept ?? undefined)}
              disabled={!concept}
            />
          ))}
          {exhausted || review ? (
            <>
              <PrimaryButton label="Explore another subject" onPress={explore} />
              {exhausted ? <PrimaryButton label="Check for new lessons" onPress={refresh} /> : null}
            </>
          ) : null}
        </>
      )}
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: colors.background,
    },
    content: {
      padding: spacing.lg,
      paddingBottom: spacing.xl,
      gap: spacing.lg,
    },
    themeButton: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeButtonPressed: {
      opacity: 0.6,
    },
    sectionLabel: {
      fontSize: scaleFont(12),
      fontWeight: '700',
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      color: colors.categoryChipText,
      marginBottom: -spacing.sm,
    },
    offlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs + 2,
      marginBottom: -spacing.sm,
    },
    offlineText: {
      fontSize: scaleFont(12.5),
      color: colors.textMuted,
    },
    noteBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
      ...shadows.card,
    },
    noteText: {
      flex: 1,
      fontSize: scaleFont(13),
      color: colors.textMuted,
      lineHeight: scaleFont(18),
    },
    personalizationBox: {
      alignItems: 'center',
      gap: spacing.md,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.lg,
      ...shadows.card,
    },
    personalizationIcon: {
      width: 48,
      height: 48,
      borderRadius: radius.pill,
      backgroundColor: colors.categoryChip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    personalizationTitle: {
      fontSize: scaleFont(20),
      fontWeight: '700',
      color: colors.text,
      textAlign: 'center',
    },
    personalizationText: {
      fontSize: scaleFont(14),
      lineHeight: scaleFont(20),
      color: colors.textMuted,
      textAlign: 'center',
    },
    doneBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.successSurface,
      borderWidth: 0.5,
      borderColor: colors.successBorder,
      borderRadius: radius.pill,
      paddingVertical: spacing.md + 2,
      // Room for the pill's curve — without this, long text pushed the icon
      // out through the rounded corner.
      paddingHorizontal: spacing.lg,
    },
    doneText: {
      color: colors.success,
      fontSize: scaleFont(16),
      fontWeight: '600',
      flexShrink: 1,
      textAlign: 'center',
    },
  });
