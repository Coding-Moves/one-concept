import { StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from '../theme';
import { Category } from '../types';

export function CategoryChip({ category }: { category: Category }) {
  return (
    <View style={styles.chip}>
      <Text style={styles.label}>{category}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
