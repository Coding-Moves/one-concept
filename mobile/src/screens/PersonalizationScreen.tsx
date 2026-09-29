import { useRefreshControl } from '../hooks/useRefreshControl';
import { fetchTopics } from '../services/topicsApi';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FollowPill } from '../components/FollowPill';
import { ScreenHeader } from '../components/ScreenHeader';
import { Surface } from '../components/Surface';
import { UnavailableState } from '../components/UnavailableState';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { useTopics } from '../hooks/useTopics';
import { scaleIcon, scaleFont, spacing, ThemeColors, typography } from '../theme';

export function PersonalizationScreen() {
  const navigation = useNavigation();
  const { loading, error, retry, topics, toggle } = useTopics();
  const online = useOnline();
  const refreshUI = useRefreshControl('subjects', fetchTopics);
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} refreshControl={refreshUI.control}>
      {refreshUI.action}
      <ScreenHeader
        eyebrow="Your learning plan"
        title="Personalization"
        subtitle="Choose the subjects that shape your next daily concept."
        action={(
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
            accessibilityRole="button"
            accessibilityLabel="Close personalization"
          >
            <Ionicons name="close" size={scaleIcon(24)} color={colors.text} />
          </Pressable>
        )}
      />

      <Text style={styles.sectionTitle}>Topics</Text>
      <Text style={styles.sectionHint}>
        Your daily concept is drawn from topics you follow. Changes apply from the next
        day’s concept.
      </Text>

      {loading ? (
        <Text style={styles.topicMeta}>Loading topics…</Text>
      ) : error && topics.length === 0 ? (
        <UnavailableState
          offline={!online}
          error={error}
          message="Connect to load your topics and choose what to learn next."
          onRetry={retry}
        />
      ) : topics.length === 0 ? (
        <Text style={styles.topicMeta}>No topics are available yet.</Text>
      ) : (
        <Surface style={styles.list}>
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
        </Surface>
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
    closeButton: {
      minWidth: 44,
      minHeight: 44,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionTitle: {
      ...typography.title,
      fontSize: scaleFont(22),
      color: colors.text,
      marginTop: spacing.lg,
      marginBottom: spacing.xs,
    },
    sectionHint: {
      fontSize: scaleFont(13),
      color: colors.textMuted,
      lineHeight: scaleFont(19),
      marginBottom: spacing.lg,
    },
    list: {
      gap: 0,
      paddingVertical: spacing.xs,
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
      fontSize: scaleFont(17),
      fontWeight: '600',
      color: colors.text,
    },
    topicMeta: {
      fontSize: scaleFont(13),
      color: colors.textMuted,
    },
  });
