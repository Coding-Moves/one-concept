import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FollowPill } from '../components/FollowPill';
import { useTheme } from '../context/ThemeContext';
import { useTopics } from '../hooks/useTopics';
import { radius, spacing, ThemeColors, typography } from '../theme';

export function PersonalizationScreen() {
  const navigation = useNavigation();
  const { loading, topics, toggle } = useTopics();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.title}>Personalization</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.alertsCard}>
        <View style={styles.alertsLeft}>
          <Ionicons name="notifications-outline" size={22} color={colors.text} />
          <View>
            <Text style={styles.alertsTitle}>Alerts</Text>
            <Text style={styles.alertsSubtitle}>Daily reminders arrive in Phase 3</Text>
          </View>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
      </View>

      <Text style={styles.sectionTitle}>Topics for you</Text>
      <Text style={styles.sectionHint}>
        Your daily concept is drawn from topics you follow. Changes apply from the next
        day’s concept.
      </Text>

      {loading ? (
        <Text style={styles.topicMeta}>Loading topics…</Text>
      ) : topics.length === 0 ? (
        <Text style={styles.topicMeta}>
          Couldn’t load topics — check your connection and reopen this screen.
        </Text>
      ) : (
        <View style={styles.list}>
          {topics.map((topic, index) => (
            <View key={topic.slug}>
              {index > 0 && <View style={styles.separator} />}
              <View style={styles.row}>
                <View style={styles.rowText}>
                  <Text style={styles.topicName}>{topic.name}</Text>
                  <Text style={styles.topicMeta}>{topic.conceptCount} concepts</Text>
                </View>
                <FollowPill following={topic.following} onPress={() => toggle(topic.slug)} />
              </View>
            </View>
          ))}
        </View>
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
    },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    title: {
      ...typography.title,
      fontSize: 24,
      color: colors.text,
    },
    closeButton: {
      padding: spacing.xs,
    },
    alertsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.md,
      marginBottom: spacing.xl,
    },
    alertsLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.md,
    },
    alertsTitle: {
      fontSize: 16,
      fontWeight: '700',
      color: colors.text,
    },
    alertsSubtitle: {
      fontSize: 12,
      color: colors.textMuted,
      marginTop: 2,
    },
    sectionTitle: {
      ...typography.title,
      fontSize: 22,
      color: colors.text,
      marginBottom: spacing.xs,
    },
    sectionHint: {
      fontSize: 13,
      color: colors.textMuted,
      lineHeight: 19,
      marginBottom: spacing.lg,
    },
    list: {
      gap: 0,
    },
    separator: {
      height: 1,
      backgroundColor: colors.border,
      opacity: 0.6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: spacing.md,
      gap: spacing.md,
    },
    rowText: {
      flexShrink: 1,
      gap: 2,
    },
    topicName: {
      fontSize: 17,
      fontWeight: '600',
      color: colors.text,
    },
    topicMeta: {
      fontSize: 13,
      color: colors.textMuted,
    },
  });
