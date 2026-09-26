import { ReactNode, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { CategoryChip } from './CategoryChip';
import { LikeCount } from './LikeCount';
import { useTheme } from '../context/ThemeContext';
import { radius, scaleFont, shadows, spacing, ThemeColors } from '../theme';

interface Props {
  title: string;
  category?: string;
  likes: number;
  trailing?: ReactNode;
  onPress: () => void;
  accessibilityLabel: string;
}

/** Compact, resilient row shared by Saved and History collection screens. */
export function CollectionConceptRow({ title, category, likes, trailing, onPress, accessibilityLabel }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>{title}</Text>
        <View style={styles.meta}>
          {category ? <CategoryChip category={category} /> : null}
          <LikeCount count={likes} />
        </View>
      </View>
      {trailing ? <View style={styles.trailing}>{trailing}</View> : null}
    </Pressable>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.sm + 4,
      gap: spacing.sm,
      ...shadows.card,
    },
    pressed: { opacity: 0.72 },
    content: { flex: 1, minWidth: 0, gap: spacing.xs },
    title: { fontSize: scaleFont(15), lineHeight: scaleFont(20), fontWeight: '600', color: colors.text },
    meta: { minWidth: 0, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
    trailing: { flexShrink: 0, alignItems: 'flex-end' },
  });
