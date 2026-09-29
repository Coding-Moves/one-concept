import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleFont, radius, spacing, ThemeColors } from '../theme';
import { Concept } from '../types';
import { CategoryChip } from './CategoryChip';
import { Surface } from './Surface';

export function ConceptCard({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Surface style={styles.card}>
      <CategoryChip category={concept.category} />
      <Text style={styles.title}>{concept.title}</Text>
      <Text style={styles.summary}>{concept.summary}</Text>
      {concept.example ? (
        <View style={styles.exampleBox}>
          <Text style={styles.exampleLabel}>Example</Text>
          <Text style={styles.exampleText}>{concept.example}</Text>
        </View>
      ) : null}
    </Surface>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    card: {
      borderRadius: radius.xl,
      gap: spacing.md,
    },
    title: {
      fontSize: scaleFont(24),
      lineHeight: scaleFont(30),
      fontFamily: 'SpaceGrotesk_700Bold',
      color: colors.text,
    },
    summary: {
      fontSize: scaleFont(16),
      lineHeight: scaleFont(26),
      color: colors.textSecondary,
    },
    exampleBox: {
      backgroundColor: colors.surfaceSubtle,
      borderRadius: radius.md,
      padding: spacing.md,
      gap: spacing.xs,
    },
    exampleLabel: {
      fontSize: scaleFont(11),
      fontWeight: '700',
      letterSpacing: 1.2,
      textTransform: 'uppercase',
      color: colors.categoryChipText,
    },
    exampleText: {
      fontSize: scaleFont(14.5),
      lineHeight: scaleFont(22),
      color: colors.textSecondary,
    },
  });
