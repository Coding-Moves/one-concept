import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { AnimatedFlame } from '../components/AnimatedFlame';
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

export type ProfileStackParamList = {
  ProfileHome: undefined;
  Personalization: undefined;
  Saved: undefined;
  About: undefined;
};

export function ProfileScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'ProfileHome'>>();
  const { progress, streaks } = useProgress();
  const { email, signOut } = useAuth();
  const { colors, mode, toggle } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  // The list itself now lives on a dedicated Saved screen (issue #131); the
  // Profile only needs the count. Use bookmarks.length — the same source as the
  // activity card above, and the one that updates optimistically on a save so
  // the two counts never disagree.
  const savedCount = progress.bookmarks.length;

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
      setPrefs(prefs); // revert the visual toggle…
      Alert.alert("Couldn't update reminders", 'Check your connection and try again.');
    }
  }, [prefs]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={scaleIcon(26)} color={colors.primary} />
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
            size={scaleIcon(22)}
            color={streaks.current > 0 ? colors.streak : colors.textMuted}
            active={streaks.current > 0}
          />
          <Text style={styles.cardValue}>{streaks.current} days</Text>
          <Text style={styles.cardLabel}>Daily streak</Text>
        </View>
        <View style={styles.card}>
          <Ionicons name="pulse" size={scaleIcon(22)} color={colors.primary} />
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
          <Ionicons name="sparkles-outline" size={scaleIcon(20)} color={colors.text} />
          <View>
            <Text style={styles.rowTitle}>Personalize your feed</Text>
            <Text style={styles.rowSubtitle}>
              Following {progress.followedTopics.length} of 5 topics
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

      {prefs ? (
        <View style={styles.rowCard}>
          <View style={styles.rowLeft}>
            <Ionicons name="notifications-outline" size={scaleIcon(20)} color={colors.text} />
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
