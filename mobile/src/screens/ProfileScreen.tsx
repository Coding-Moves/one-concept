import { useRefreshControl } from '../hooks/useRefreshControl';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { AchievementPreview } from '../components/AchievementPreview';
import { AnimatedFlame } from '../components/AnimatedFlame';
import { Surface } from '../components/Surface';
import { SettingRow } from '../components/SettingRow';
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
  const notificationMutation = useRef(0);
  const notificationQueue = useRef(Promise.resolve());
  const pendingFieldRevision = useRef({ daily: 0, weekly: 0 });
  const prefsRef = useRef<NotificationPrefs | null>(null);
  const mounted = useRef(true);
  const [pendingNotifications, setPendingNotifications] = useState({ daily: false, weekly: false });
  const [deviceRegistrationPending, setDeviceRegistrationPending] = useState(false);
  const [reminderMessage, setReminderMessage] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  // Server-owned preference; absent until the first state fetch succeeds.
  const [prefsReload, setPrefsReload] = useState(0);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const setCurrentPrefs = useCallback((next: NotificationPrefs | null) => {
    prefsRef.current = next;
    setPrefs(next);
  }, []);
  const [subtopics, setSubtopics] = useState<SubtopicProgress[]>([]);
  useEffect(() => {
    let active = true;
    // Cached copy first so the row is there instantly (and offline); the
    // server answer replaces it when it arrives.
    const observedMutation = notificationMutation.current;
    getCachedNotificationPrefs(session!.user.id).then((p) => {
      if (active && p && observedMutation === notificationMutation.current) setCurrentPrefs(prefsRef.current ?? p);
    });
    getNotificationPrefs(session!.user.id)
      .then((p) => active && observedMutation === notificationMutation.current && setCurrentPrefs(p))
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
  const hasFollowedTopics = progress.followedTopics.length > 0;

  const setNotificationPending = useCallback((field: 'daily' | 'weekly', revision: number, value: boolean) => {
    if (pendingFieldRevision.current[field] !== revision) return;
    setPendingNotifications(current => current[field] === value ? current : { ...current, [field]: value });
  }, []);

  const registerDevice = useCallback(async (userId: string) => {
    setDeviceRegistrationPending(true);
    try {
      const result = await registerForReminders(userId);
      if (!mounted.current || result === 'registered') return;
      setReminderMessage(result === 'denied'
        ? 'Reminders are saved. Allow notifications in your phone settings to receive them.'
        : 'Reminders are saved. Push notifications need a supported physical device.');
    } catch {
      if (mounted.current) setReminderMessage('Reminders are saved, but this device could not register. Use Retry device registration when you are connected.');
    } finally {
      if (mounted.current) setDeviceRegistrationPending(false);
    }
  }, []);

  const saveNotificationPrefs = useCallback((field: 'daily' | 'weekly') => {
    const userId = session?.user.id;
    const current = prefsRef.current;
    if (!userId || !current || (field === 'weekly' && !current.enabled)) return;
    const previous = current;
    const next = field === 'daily'
      ? { ...current, enabled: !current.enabled }
      : { ...current, weekly_quiz_enabled: !current.weekly_quiz_enabled };
    const revision = ++notificationMutation.current;
    pendingFieldRevision.current[field] = revision;
    setCurrentPrefs(next);
    setNotificationPending(field, revision, true);
    setReminderMessage('');

    // Writes are queued so a rapid pair of taps cannot send stale full preference
    // documents. Each switch still moves immediately; only its own row reports saving.
    notificationQueue.current = notificationQueue.current.catch(() => {}).then(async () => {
      try {
        const confirmed = await putNotificationPrefs(next, userId);
        if (!mounted.current) return;
        if (notificationMutation.current === revision) setCurrentPrefs(confirmed);
        setNotificationPending(field, revision, false);
        if (field === 'daily' && next.enabled && !previous.enabled && notificationMutation.current === revision && prefsRef.current?.enabled) void registerDevice(userId);
      } catch {
        if (!mounted.current) return;
        if (notificationMutation.current === revision) {
          setCurrentPrefs(previous);
          setReminderMessage('Could not save that reminder choice. The previous setting was restored; check your connection and try again.');
        }
        setNotificationPending(field, revision, false);
      }
    });
  }, [registerDevice, session?.user.id, setCurrentPrefs, setNotificationPending]);

  const retryReminders = () => {
    if (!session?.user.id || deviceRegistrationPending) return;
    void registerDevice(session.user.id);
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

      <SettingRow
        icon={mode === 'dark' ? 'moon-outline' : 'sunny-outline'}
        tone="achievement"
        title="Dark mode"
        subtitle="Use the color theme that feels most comfortable."
        value={mode === 'dark'}
        onValueChange={toggle}
        accessibilityLabel="Dark mode"
        accessibilityHint="Switches between light and dark color themes."
      />

      <View style={styles.rowCard}>
        <View style={styles.rowLeft}>
          <View>
            <Text style={styles.rowTitle}>Learning timezone</Text>
            <Text style={styles.rowSubtitle}>{progress.timezone ?? 'Loading…'} · Daily lessons and reminders</Text>
          </View>
        </View>
      </View>

      {prefs ? <>
        <SettingRow
          icon="notifications-outline"
          tone="primary"
          title="Daily reminders"
          subtitle={prefs.enabled
            ? hasFollowedTopics
              ? `On · ${prefs.reminder_times.join(' · ')} in your learning timezone.`
              : 'On, but paused until you follow a topic. Your choice is saved.'
            : 'Off · turn on for future daily learning reminders.'}
          value={prefs.enabled}
          onValueChange={() => saveNotificationPrefs('daily')}
          pending={pendingNotifications.daily}
          accessibilityLabel="Daily reminders"
          accessibilityHint="Turns future daily reminders on or off. Device permission is needed to receive them."
        />
        <SettingRow
          icon="help-circle-outline"
          tone="quiz"
          title="Weekly quiz alerts"
          subtitle={!prefs.enabled
            ? 'Turn on Daily reminders first to enable weekly quiz alerts.'
            : prefs.weekly_quiz_enabled
              ? `On · once when a new quiz is ready at 9 AM (${progress.timezone ?? 'your learning timezone'}).`
              : `Off · turn on to hear about future quizzes at 9 AM (${progress.timezone ?? 'your learning timezone'}).`}
          value={prefs.weekly_quiz_enabled ?? false}
          onValueChange={() => saveNotificationPrefs('weekly')}
          pending={pendingNotifications.weekly}
          disabled={!prefs.enabled}
          accessibilityLabel="Weekly quiz notifications"
          accessibilityHint={prefs.enabled
            ? 'Turns future weekly quiz alerts on or off.'
            : 'Unavailable until Daily reminders are turned on.'}
        />
      </> : null}

      {reminderMessage ? <Pressable accessibilityRole="button" disabled={deviceRegistrationPending} onPress={() => { setReminderMessage(''); setPrefsReload(n => n + 1); }} style={styles.rowCard}>
        <Text style={styles.rowTitle}>Reload reminder settings</Text>
      </Pressable> : null}
      {reminderMessage ? <Text accessibilityLiveRegion="polite" style={styles.rowSubtitle}>{reminderMessage}</Text> : null}
      {prefs?.enabled && reminderMessage ? <Pressable accessibilityRole="button" disabled={deviceRegistrationPending} onPress={retryReminders} style={styles.rowCard}>
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
