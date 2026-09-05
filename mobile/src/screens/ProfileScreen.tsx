import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { AnimatedFlame } from '../components/AnimatedFlame';
import { CategoryChip } from '../components/CategoryChip';
import { useAuth } from '../context/AuthContext';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS } from '../data/concepts';
import {
  getCachedNotificationPrefs,
  getNotificationPrefs,
  NotificationPrefs,
  putNotificationPrefs,
  registerForReminders,
} from '../services/notifications';
import { radius, shadows, spacing, ThemeColors, typography } from '../theme';

export type ProfileStackParamList = {
  ProfileHome: undefined;
  Personalization: undefined;
};

const CONCEPTS_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

export function ProfileScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>>();
  const { progress, streaks } = useProgress();
  const { email, signOut } = useAuth();
  const { colors, mode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // Server-backed state carries saved concepts with their titles/topics; the
  // signed-out demo resolves bookmarked ids against the bundled catalog. Mapping
  // signed-in bookmarks through the 20-concept demo is exactly what hid saved
  // lessons from the 125+ server catalog (issue #90).
  const saved = progress.savedConcepts
    ? progress.savedConcepts.map((s) => ({
        id: s.conceptId,
        title: s.title,
        topicName: s.topicName,
      }))
    : progress.bookmarks
        .map((id) => CONCEPTS_BY_ID.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({ id: c.id, title: c.title, topicName: c.category as string }));

  // Server-owned preference; absent until the first state fetch succeeds.
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  useEffect(() => {
    let active = true;
    // Cached copy first so the row is there instantly (and offline); the
    // server answer replaces it when it arrives.
    getCachedNotificationPrefs().then((p) => {
      if (active && p) setPrefs((current) => current ?? p);
    });
    getNotificationPrefs()
      .then((p) => active && setPrefs(p))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const toggleReminders = useCallback(async () => {
    if (!prefs) return;
    const next = { ...prefs, enabled: !prefs.enabled };
    setPrefs(next); // optimistic; revert on failure
    try {
      setPrefs(await putNotificationPrefs(next));
      if (next.enabled) registerForReminders().catch(() => {});
    } catch {
      setPrefs(prefs);
    }
  }, [prefs]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={26} color={colors.primary} />
        </View>
        <View style={styles.headerText}>
          <Text style={styles.name} numberOfLines={1} ellipsizeMode="tail">
            {email ? email.split('@')[0] : 'Learner'}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1} ellipsizeMode="middle">
            {email ?? 'Signed out'}
          </Text>
        </View>
      </View>

      <View style={styles.cardsRow}>
        <View style={styles.card}>
          <AnimatedFlame
            size={22}
            color={streaks.current > 0 ? colors.streak : colors.textMuted}
            active={streaks.current > 0}
          />
          <Text style={styles.cardValue}>{streaks.current} days</Text>
          <Text style={styles.cardLabel}>Daily streak</Text>
        </View>
        <View style={styles.card}>
          <Ionicons name="pulse" size={22} color={colors.primary} />
          <Text style={styles.cardValue}>
            {progress.likes.length} likes · {progress.bookmarks.length} saved
          </Text>
          <Text style={styles.cardLabel}>Your activity</Text>
        </View>
      </View>

      <Pressable
        onPress={() => navigation.navigate('Personalization')}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="sparkles-outline" size={20} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>Personalize your feed</Text>
            <Text style={styles.rowSubtitle}>
              Following {progress.followedTopics.length} of 5 topics
            </Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </Pressable>

      <View style={styles.rowCard}>
        <View style={styles.rowLeft}>
          <Ionicons
            name={mode === 'dark' ? 'moon-outline' : 'sunny-outline'}
            size={20}
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

      {prefs ? (
        <View style={styles.rowCard}>
          <View style={styles.rowLeft}>
            <Ionicons name="notifications-outline" size={20} color={colors.text} />
            <View>
              <Text style={styles.rowTitle}>Daily reminders</Text>
              <Text style={styles.rowSubtitle}>
                {prefs.enabled
                  ? `Until you finish: ${prefs.reminder_times.join(' · ')}`
                  : 'Off — no nudges'}
              </Text>
            </View>
          </View>
          <Switch
            value={prefs.enabled}
            onValueChange={toggleReminders}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor={colors.surface}
          />
        </View>
      ) : null}

      <Text style={styles.sectionLabel}>Saved concepts</Text>
      {saved.length === 0 ? (
        <Text style={styles.emptyText}>
          Tap the bookmark on a concept to keep it here for later.
        </Text>
      ) : (
        <View style={styles.savedList}>
          {saved.map((c) => (
            <View key={c.id} style={styles.savedRow}>
              <View style={styles.savedText}>
                <Text style={styles.savedTitle}>{c.title}</Text>
                {c.topicName ? <CategoryChip category={c.topicName} /> : null}
              </View>
              <Ionicons name="bookmark" size={16} color={colors.primary} />
            </View>
          ))}
        </View>
      )}

      <Pressable
        onPress={signOut}
        style={({ pressed }) => [styles.rowCard, pressed && styles.rowPressed]}
        accessibilityRole="button"
      >
        <View style={styles.rowLeft}>
          <Ionicons name="log-out-outline" size={20} color={colors.streak} />
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
      fontSize: 24,
      color: colors.text,
    },
    subtitle: {
      fontSize: 12,
      color: colors.textMuted,
      lineHeight: 17,
    },
    cardsRow: {
      flexDirection: 'row',
      gap: spacing.md,
    },
    card: {
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      ...shadows.card,
      padding: spacing.md,
      gap: spacing.xs,
      alignItems: 'flex-start',
    },
    cardValue: {
      fontSize: 15,
      fontWeight: '700',
      color: colors.text,
    },
    cardLabel: {
      fontSize: 12,
      color: colors.textMuted,
    },
    rowCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      ...shadows.card,
    },
    rowPressed: {
      opacity: 0.7,
    },
    rowLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
      flexShrink: 1,
    },
    rowTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    rowSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      color: colors.textMuted,
      marginBottom: -spacing.sm,
    },
    emptyText: {
      fontSize: 14,
      color: colors.textMuted,
    },
    savedList: {
      gap: spacing.sm,
    },
    savedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
      gap: spacing.md,
      ...shadows.card,
    },
    savedText: {
      flexShrink: 1,
      gap: spacing.sm,
    },
    savedTitle: {
      fontSize: 15,
      fontWeight: '600',
      color: colors.text,
    },
    version: {
      fontSize: 12,
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: spacing.md,
    },
  });
