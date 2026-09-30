import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { acknowledgeSubtopicCompletion } from '../services/subtopicProgressApi';
import type { SubtopicCompletion } from '../types';
import { scaleIcon, scaleFont, radius, spacing, ThemeColors, typography } from '../theme';

export function SubtopicCompletionCard({ completion }: { completion: SubtopicCompletion }) {
  const { session } = useAuth();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    if (session?.user.id) void acknowledgeSubtopicCompletion(session.user.id, completion).catch(() => {});
  }, [completion, session?.user.id]);

  return <View accessibilityRole="alert" style={styles.card}>
    <Ionicons name="ribbon-outline" size={scaleIcon(22)} color={colors.success} />
    <View style={styles.copy}>
      <Text style={styles.title}>Subtopic complete</Text>
      <Text style={styles.body}>You’ve completed every available concept in {completion.subtopic_name}.</Text>
    </View>
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm,
    borderRadius: radius.lg, padding: spacing.md, backgroundColor: colors.successSurface,
  },
  copy: { flex: 1, gap: 2 },
  title: { ...typography.title, fontSize: scaleFont(16), color: colors.success },
  body: { fontSize: scaleFont(13), lineHeight: scaleFont(19), color: colors.textSecondary },
});
