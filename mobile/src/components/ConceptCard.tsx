import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, shadows, spacing, ThemeColors } from '../theme';
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
      borderRadius: radius.xl,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.lg,
      gap: spacing.md,
      ...shadows.card,
    },
    title: {
      fontSize: 24,
      lineHeight: 30,
      fontFamily: 'SpaceGrotesk_700Bold',
      color: colors.text,
    },
    summary: {
      fontSize: 16,
      lineHeight: 26,
      color: colors.textSecondary,
    },
    exampleBox: {
      backgroundColor: colors.categoryChip,
      borderRadius: radius.md,
      borderLeftWidth: 3,
      borderLeftColor: colors.primary,
      padding: spacing.md,
      gap: spacing.xs,
    },
    exampleLabel: {
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.categoryChipText,
    },
    exampleText: {
      fontSize: 14.5,
      lineHeight: 22,
      color: colors.textSecondary,
    },
  });
