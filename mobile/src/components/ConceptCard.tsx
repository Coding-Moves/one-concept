import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors, typography } from '../theme';
import { Concept } from '../types';
import { CategoryChip } from './CategoryChip';

export function ConceptCard({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.card}>
      <CategoryChip category={concept.category} />
      <Text style={styles.title}>{concept.title}</Text>
      <Text style={styles.summary}>{concept.summary}</Text>
      {concept.example ? (
        <View style={styles.exampleBox}>
          <Text style={styles.exampleLabel}>Example</Text>
          <Text style={styles.exampleText}>{concept.example}</Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
    },
    title: {
      ...typography.heading,
      color: colors.text,
    },
    summary: {
      ...typography.body,
      color: colors.textSecondary,
    },
    exampleBox: {
      backgroundColor: colors.background,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    exampleLabel: {
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.8,
      textTransform: 'uppercase',
      color: colors.textMuted,
    },
    exampleText: {
      fontSize: 14,
      lineHeight: 21,
      color: colors.textSecondary,
    },
  });
