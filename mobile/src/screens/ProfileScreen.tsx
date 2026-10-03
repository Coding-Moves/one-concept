import { useRefreshControl } from '../hooks/useRefreshControl';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { AchievementPreview } from '../components/AchievementPreview';
import { AnimatedFlame } from '../components/AnimatedFlame';
import { Surface } from '../components/Surface';
import { useAuth } from '../context/AuthContext';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import {
  getCachedNotificationPrefs,
  getNotificationPrefs,
  NotificationPrefs,
  putNotificationPrefs,
  registerForReminders,
} from '../services/notifications';
import { scaleIcon, scaleFont, radius, shadows, spacing, ThemeColors, typography } from '../theme';
import { getSubtopicProgress, SubtopicProgress } from '../services/subtopicProgressApi';

export type ProfileStackParamList = {
  ProfileHome: undefined;
  EditProfile: undefined;
  ProfileSharing: undefined;
  Connections: undefined;
  Personalization: undefined;
  Saved: undefined;
  About: undefined;
  Achievements: undefined;
  Analytics: undefined;
  SubtopicQuizzes: undefined;
  SubtopicQuiz: { completionId: string; topicName: string; subtopicName: string };
};

export function ProfileScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>>();
  const { progress, streaks, refresh } = useProgress();
  const { email, session, signOut } = useAuth();
  const { colors, mode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const refreshUI = useRefreshControl('profile', refresh);

  // The list itself now lives on a dedicated Saved screen (issue #131); the
  // Profile only needs the count. Use bookmarks.length — the same source as the
  // activity card above, and the one that updates optimistically on a save so
  // the two counts never disagree.
  const savedCount = progress.bookmarks.length;
  const reminderPending = useRef(false);
  const mounted = useRef(true);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMessage, setReminderMessage] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Server-owned preference; absent until the first state fetch succeeds.
  const [prefsReload, setPrefsReload] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [subtopics, setSubtopics] = useState<SubtopicProgress[]>([]);
  useEffect(() => {
    let active = true;
    // Cached copy first so the row is there instantly (and offline); the
    // server answer replaces it when it arrives.
    getCachedNotificationPrefs(session!.user.id).then((p) => {
      if (active && p) setPrefs((current) => current ?? p);
    });
    getNotificationPrefs(session!.user.id)
      .then((p) => active && setPrefs(p))
      .catch(() => { if (active) setReminderMessage('Could not refresh reminder settings. Check your connection and reload.'); });
    return () => {
      active = false;
    };
  }, [session?.user.id, prefsReload]);

  useEffect(() => {
    if (!session?.user.id) return;
    let active = true;
    getSubtopicProgress(session.user.id).then(items => {
      if (active) setSubtopics(items);
    }).catch(() => { if (active) setSubtopics([]); });
    return () => { active = false; };
  }, [session?.user.id]);

  const completedSubtopics = subtopics.filter(item => item.completed).length;

  const toggleReminders = useCallback(async (weekly = false) => {
    if (!prefs || !session?.user.id || reminderPending.current) return;
    const previous = prefs;
    const next = weekly ? { ...prefs, weekly_quiz_enabled: !prefs.weekly_quiz_enabled } : { ...prefs, enabled: !prefs.enabled };
    // Move the switch immediately. The request remains serialized, and a failed
    // save restores the last server-confirmed value instead of pretending it worked.
    reminderPending.current = true; setReminderBusy(true); setReminderMessage(''); setPrefs(next);
    try {
      const confirmed = await putNotificationPrefs(next, session.user.id);
      if (!mounted.current) return;
      setPrefs(confirmed);
      if (next.enabled && (!weekly || next.weekly_quiz_enabled)) {
        try {
          const result = await registerForReminders(session.user.id);
          if (mounted.current && result !== 'registered') setReminderMessage(result === 'denied'
            ? 'Reminders are enabled, but this device blocks notifications. Allow them in your phone settings.'
            : 'Reminders are enabled for your account. Push notifications require a supported physical device.');
        } catch {
          if (mounted.current) setReminderMessage('Reminders are enabled, but this device could not register. Check your connection, then use Retry device registration.');
        }
      }
    } catch {
      if (mounted.current) { setPrefs(previous); setReminderMessage('Could not save reminder settings. The previous choice was restored; check your connection and try again.'); }
    } finally {
      reminderPending.current = false;
      if (mounted.current) setReminderBusy(false);
    }
  }, [prefs, session?.user.id]);

  const retryReminders = async () => {
    if (!session?.user.id || reminderPending.current) return;
    reminderPending.current = true; setReminderBusy(true);
    try {
      const status = await registerForReminders(session.user.id);
      if (mounted.current) setReminderMessage(status === 'registered' ? 'This device is ready for reminders.' : 'Allow notifications in your phone settings on a supported physical device.');
    } catch { if (mounted.current) setReminderMessage('Could not register this device. Check your connection and retry.'); }
    finally { reminderPending.current = false; if (mounted.current) setReminderBusy(false); }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={refreshUI.control}>
      {refreshUI.action}
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={scaleIcon(26)} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name}>
            {progress.displayName?.trim() || (email ? email.split('@')[0] : 'Learner')}
          </Text>
          <Text style={styles.subtitle}>
            {email ?? 'Signed out'}
          </Text>
        </View>
      </View>

      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('EditProfile')} style={styles.rowCard}>
        <Text style={styles.rowTitle}>Edit profile</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('ProfileSharing')} style={styles.rowCard}>
        <Text style={styles.rowTitle}>Public profile & sharing</Text>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Connections')} style={styles.rowCard}>
        <Text style={styles.rowTitle}>Connections</Text>
        <Ionicons name="people-outline" size={22} color={colors.primary} />
      </Pressable>
      <View style={styles.cardsRow}>
        <Surface style={styles.card}>
          <AnimatedFlame
            size={scaleIcon(22)}
            color={streaks.current > 0 ? colors.streak : colors.textMuted}
            active={streaks.current > 0}
          />
          <Text style={styles.cardValue}>{streaks.current} days</Text>
          <Text style={styles.cardLabel}>Daily streak</Text>
        </Surface>
        <Surface style={styles.card}>
          <Ionicons name="pulse" size={scaleIcon(22)} color={colors.primary} />
          <Text style={styles.cardValue}>
            {progress.likes.length} likes · {progress.bookmarks.length} saved
          </Text>
          <Text style={styles.cardLabel}>Your activity</Text>
        </Surface>
      </View>

      <AchievementPreview onPress={() => navigation.navigate('Achievements')} />

      <Pressable
        onPress={() => navigation.navigate('Analytics')}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel="Open learning activity analytics"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="bar-chart-outline" size={scaleIcon(20)} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>Learning analytics</Text>
            <Text style={styles.rowSubtitle}>Progress, activity, quizzes, and achievements</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={scaleIcon(20)} color={colors.textMuted} />
      </Pressable>

      {subtopics.length > 0 ? <Pressable
        onPress={() => navigation.navigate('SubtopicQuizzes')}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
        accessibilityLabel={`${completedSubtopics} of ${subtopics.length} available learning paths complete. Open optional quizzes.`}
      >
        <View style={styles.rowLeft}>
          <Ionicons name="layers-outline" size={scaleIcon(20)} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>Learning paths</Text>
            <Text style={styles.rowSubtitle}>{completedSubtopics === 0 ? 'Complete a subtopic to unlock optional quizzes' : `${completedSubtopics} of ${subtopics.length} available subtopics complete`}</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={scaleIcon(20)} color={colors.textMuted} />
      </Pressable> : null}

      <Pressable
        onPress={() => navigation.navigate('Personalization')}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="sparkles-outline" size={scaleIcon(20)} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>Personalize your feed</Text>
            <Text style={styles.rowSubtitle}>
              Following {progress.followedTopics.length} topics
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={scaleIcon(20)} color={colors.textMuted} />
      </Pressable>

      <Pressable
        onPress={() => navigation.navigate('About')}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="information-circle-outline" size={scaleIcon(20)} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>About</Text>
            <Text style={styles.rowSubtitle}>Version, what this app is, and how it works</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={scaleIcon(20)} color={colors.textMuted} />
      </Pressable>

      <View style={styles.rowCard}>
        <View style={styles.rowLeft}>
          <Ionicons
            name={mode === 'dark' ? 'moon-outline' : 'sunny-outline'}
            size={scaleIcon(20)}
            color={colors.text}
          />
          <Text style={styles.rowTitle}>Dark mode</Text>
        </View>
        <Switch
          value={mode === 'dark'}
          onValueChange={toggle}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.surface}
        />
      </View>

      <View style={styles.rowCard}>
        <View style={styles.rowLeft}>
          <View>
            <Text style={styles.rowTitle}>Learning timezone</Text>
            <Text style={styles.rowSubtitle}>{progress.timezone ?? 'Loading…'} · Daily lessons and reminders</Text>
          </View>
        </View>
      </View>

      {prefs ? (
        <View style={styles.rowCard}>
          <View style={styles.rowLeft}>
            <Ionicons name="notifications-outline" size={scaleIcon(20)} color={colors.text} />
            <View>
              <Text style={styles.rowTitle}>Notifications</Text>
              <Text style={styles.rowSubtitle}>
                {prefs.enabled
                  ? `Daily reminders: ${prefs.reminder_times.join(' · ')}`
                  : 'Off — no nudges'}
              </Text>
            </View>
          </View>
          <Switch
            accessibilityLabel="Notifications"
            disabled={reminderBusy}
            accessibilityState={{ disabled: reminderBusy, busy: reminderBusy, checked: prefs.enabled }}
            value={prefs.enabled}
            onValueChange={() => void toggleReminders()}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.surface}
          />
        </View>
      ) : null}

      {prefs && <View style={styles.rowCard}>
        <View style={styles.rowLeft}><View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>Weekly quiz ready</Text>
          <Text style={styles.rowSubtitle}>{prefs.enabled
            ? `Once per quiz, at 9 AM (${progress.timezone ?? 'your learning timezone'}). Completed quizzes stay quiet.`
            : 'Turn on Notifications above to receive weekly quiz alerts.'}</Text>
        </View></View>
        <Switch accessibilityLabel="Weekly quiz notifications" disabled={reminderBusy || !prefs.enabled}
          accessibilityState={{ disabled: reminderBusy || !prefs.enabled, busy: reminderBusy, checked: prefs.weekly_quiz_enabled ?? false }}
          value={prefs.weekly_quiz_enabled ?? false} onValueChange={() => void toggleReminders(true)}
          trackColor={{ true: colors.primary, false: colors.border }} thumbColor={colors.onPrimary} />
      </View>}

      {reminderMessage ? <Pressable accessibilityRole="button" disabled={reminderBusy} onPress={() => { setReminderMessage(''); setPrefsReload(n => n + 1); }} style={styles.rowCard}>
        <Text style={styles.rowTitle}>Reload reminder settings</Text>
      </Pressable> : null}
      {reminderMessage ? <Text accessibilityLiveRegion="polite" style={styles.rowSubtitle}>{reminderMessage}</Text> : null}
      {prefs?.enabled && reminderMessage ? <Pressable accessibilityRole="button" disabled={reminderBusy} onPress={() => void retryReminders()} style={styles.rowCard}>
        <Text style={styles.rowTitle}>Retry device registration</Text>
      </Pressable> : null}

      <Pressable
        onPress={() => navigation.navigate('Saved')}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="bookmark-outline" size={scaleIcon(20)} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>Saved concepts</Text>
            <Text style={styles.rowSubtitle}>
              {savedCount === 0
                ? 'Bookmark a concept to keep it for later'
                : `${savedCount} saved · search and filter`}
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={scaleIcon(20)} color={colors.textMuted} />
      </Pressable>

      <Pressable
        onPress={signOut}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="log-out-outline" size={scaleIcon(20)} color={colors.streak} />
          <Text style={[styles.rowTitle, { color: colors.streak }]}>Sign out</Text>
        </View>
      </Pressable>

      <Text style={styles.version}>One Concept v{Constants.expoConfig?.version ?? '?'}</Text>
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
      alignItems: 'center',
      gap: spacing.md,
    },
    avatar: {
      width: 56,
      height: 56,
      borderRadius: radius.pill,
      backgroundColor: colors.categoryChip,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerText: {
      flexShrink: 1,
      gap: 2,
    },
    name: {
      ...typography.title,
      fontSize: scaleFont(24),
      color: colors.text,
    },
    subtitle: {
      fontSize: scaleFont(12),
      color: colors.textMuted,
      lineHeight: scaleFont(17),
    },
    cardsRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    card: {
      flex: 1,
      borderRadius: radius.lg,
      padding: spacing.md,
      gap: spacing.xs,
      alignItems: 'flex-start',
    },
    cardValue: {
      fontSize: scaleFont(15),
      fontWeight: '700',
      color: colors.text,
    },
    cardLabel: {
      fontSize: scaleFont(12),
      color: colors.textMuted,
    },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      padding: spacing.md,
      ...shadows.card,
    },
    rowPressed: { backgroundColor: colors.surfaceSubtle },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      flexShrink: 1,
    },
    rowTitle: {
      fontSize: scaleFont(15),
      fontWeight: '600',
      color: colors.text,
    },
    rowSubtitle: {
      fontSize: scaleFont(12),
      color: colors.textMuted,
      marginTop: 2,
    },
    version: {
      fontSize: scaleFont(12),
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing.md,
    },
  });
