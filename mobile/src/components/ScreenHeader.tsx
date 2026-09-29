import { ReactNode, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleFont, spacing, ThemeColors, typography } from '../theme';

interface Props {
  title: string;
  subtitle?: string;
  eyebrow?: string;
  action?: ReactNode;
  large?: boolean;
}

/** Shared hierarchy for screens: one clear task, then its supporting context. */
export function ScreenHeader({ title, subtitle, eyebrow, action, large = false }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
        <Text accessibilityRole="header" style={[styles.title, large && styles.largeTitle]}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  copy: { flex: 1, minWidth: 0, gap: spacing.xs },
  action: { flexShrink: 0 },
  eyebrow: {
    color: colors.categoryChipText,
    fontSize: scaleFont(12),
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
  },
  title: { ...typography.title, color: colors.text },
  largeTitle: { fontSize: scaleFont(30) },
  subtitle: { color: colors.textMuted, fontSize: scaleFont(14), lineHeight: scaleFont(20) },
});
