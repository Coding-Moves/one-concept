import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors } from '../theme';
import { Category } from '../types';

export function CategoryChip({ category }: { category: Category }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{category}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      backgroundColor: colors.categoryChip,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    label: {
      color: colors.categoryChipText,
      fontSize: 13,
      fontWeight: '600',
    },
  });
