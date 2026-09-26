import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleFont, radius, spacing, ThemeColors } from '../theme';

// Accepts any label string: the app's Category values and the server's topic
// names (which match those values) both render the same way.
export function CategoryChip({ category }: { category: string }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.chip}>
      <Text style={styles.label} numberOfLines={1}>{category}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      maxWidth: '100%',
      flexShrink: 1,
      backgroundColor: colors.categoryChip,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs + 2,
    },
    label: {
      flexShrink: 1,
      color: colors.categoryChipText,
      fontSize: scaleFont(11.5),
      fontWeight: '700',
      letterSpacing: 1,
      textTransform: 'uppercase',
      lineHeight: scaleFont(16),
    },
  });
