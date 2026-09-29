import { ReactNode, useMemo } from 'react';
import { StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, shadows, spacing, ThemeColors } from '../theme';

interface Props {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  tone?: 'default' | 'subtle';
}

/** Borderless shared container. Elevation and colour, not outlines, separate content. */
export function Surface({ children, style, tone = 'default' }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <View style={[styles.surface, tone === 'subtle' && styles.subtle, style]}>{children}</View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  surface: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    ...shadows.card,
  },
  subtle: { backgroundColor: colors.surfaceSubtle, borderRadius: radius.md, ...shadows.card, shadowOpacity: 0.03, elevation: 1 },
});
