import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConceptActions } from '../components/ConceptActions';
import { ConceptCard } from '../components/ConceptCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { SkeletonBlock, SkeletonConceptCard } from '../components/Skeleton';
import { StreakBadge } from '../components/StreakBadge';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { useServerDaily } from '../hooks/useServerDaily';
import { toConcept } from '../services/dailyApi';
import { radius, spacing, ThemeColors, typography } from '../theme';

export function TodayScreen() {
  const { loading: localLoading, concept: localConcept, learnedToday, streaks, markLearned } =
    useProgress();
  const server = useServerDaily();
  const { colors, mode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const outcome = server.outcome;
  // The backend decides the day's concept; the locally-picked one is the
  // offline fallback until Phase 4 moves the rest of the state server-side.
  const serverConcept =
    outcome && outcome.status === 'ok' ? toConcept(outcome.payload) : null;
  const concept = serverConcept ?? localConcept;
  const loading = localLoading || server.loading;
  const exhausted = outcome?.status === 'exhausted';
  const offline = outcome?.status === 'ok' && outcome.stale;
  const outsideTopics =
    outcome?.status === 'ok' && outcome.payload.outside_followed_topics;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.appName}>One Concept</Text>
          <Text style={styles.tagline}>One day. One concept. One small step forward.</Text>
        </View>
        <Pressable
          onPress={toggle}
          style={({ pressed }) => [styles.themeButton, pressed && styles.themeButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          <Ionicons
            name={mode === 'dark' ? 'sunny-outline' : 'moon-outline'}
            size={20}
            color={colors.textSecondary}
          />
        </Pressable>
      </View>

      {loading ? (
        <>
          <SkeletonBlock style={{ width: '100%', height: 64, borderRadius: radius.md }} />
          <Text style={styles.sectionLabel}>Today’s concept</Text>
          <SkeletonConceptCard />
          <SkeletonBlock style={{ width: '100%', height: 50, borderRadius: radius.md }} />
        </>
      ) : (
        <>
          <StreakBadge streaks={streaks} />

          <Text style={styles.sectionLabel}>Today’s concept</Text>

          {offline ? (
            <View style={styles.noteBox}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.textMuted} />
              <Text style={styles.noteText}>
                Showing your saved copy — we couldn’t reach the server.
              </Text>
            </View>
          ) : null}

          {outsideTopics ? (
            <View style={styles.noteBox}>
              <Ionicons name="sparkles-outline" size={16} color={colors.textMuted} />
              <Text style={styles.noteText}>
                You’ve read everything in your topics, so here’s one from further afield.
              </Text>
            </View>
          ) : null}

          {exhausted ? (
            <View style={styles.noteBox}>
              <Ionicons name="checkmark-done-outline" size={16} color={colors.success} />
              <Text style={styles.noteText}>
                You’ve learned every concept available. New ones are on the way.
              </Text>
            </View>
          ) : null}

          {concept ? (
            <>
              <ConceptCard concept={concept} />
              <ConceptActions concept={concept} />
            </>
          ) : (
            <Text style={styles.tagline}>No concepts available.</Text>
          )}

          {learnedToday ? (
            <View style={styles.doneBox}>
              <Ionicons name="checkmark-circle" size={20} color={colors.success} />
              <Text style={styles.doneText}>Learned today — see you tomorrow!</Text>
            </View>
          ) : (
            <PrimaryButton label="Mark as learned" onPress={markLearned} disabled={!concept} />
          )}
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
    header: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: spacing.md,
    },
    headerText: {
      gap: spacing.xs,
      flexShrink: 1,
    },
    appName: {
      ...typography.title,
      color: colors.text,
    },
    tagline: {
      fontSize: 14,
      color: colors.textMuted,
    },
    themeButton: {
      width: 40,
      height: 40,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    themeButtonPressed: {
      opacity: 0.6,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: -spacing.sm,
    },
    noteBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: radius.md,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    noteText: {
      flex: 1,
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 18,
    },
    doneBox: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: spacing.sm,
      backgroundColor: colors.successSurface,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
    },
    doneText: {
      color: colors.success,
      fontSize: 16,
      fontWeight: '600',
    },
  });
