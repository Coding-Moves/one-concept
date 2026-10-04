import { Ionicons } from '@expo/vector-icons';
import { ComponentProps, useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, scaleFont, scaleIcon, spacing, ThemeColors, touchTarget } from '../theme';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Tone = 'primary' | 'connection' | 'quiz' | 'achievement' | 'saved' | 'streak';

interface Props {
  icon: IconName;
  tone?: Tone;
  title: string;
  subtitle: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  accessibilityLabel: string;
  accessibilityHint: string;
  disabled?: boolean;
  pending?: boolean;
}

/** A consistent, immediate native toggle with an icon-led purpose and local saving state. */
export function SettingRow({
  icon,
  tone = 'primary',
  title,
  subtitle,
  value,
  onValueChange,
  accessibilityLabel,
  accessibilityHint,
  disabled = false,
  pending = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const accent = colors[`${tone}Accent`];
  const accentSurface = colors[`${tone}AccentSurface`];

  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <View style={[styles.iconTile, { backgroundColor: accentSurface }]}>
        <Ionicons name={icon} size={scaleIcon(20)} color={accent} accessible={false} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {pending ? <Text accessibilityLiveRegion="polite" style={[styles.status, { color: accent }]}>Saving…</Text> : null}
      </View>
      <View style={styles.control}>
        {pending ? <ActivityIndicator size="small" color={accent} accessibilityLabel={`${title} is saving`} /> : null}
        <Switch
          accessibilityLabel={accessibilityLabel}
          accessibilityHint={accessibilityHint}
          accessibilityState={{ disabled, busy: pending, checked: value }}
          disabled={disabled}
          value={value}
          onValueChange={onValueChange}
          trackColor={{ false: colors.border, true: accent }}
          thumbColor={value ? colors.onPrimary : colors.surface}
        />
      </View>
    </View>
  );
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  row: {
    minHeight: touchTarget + spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm + 2,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
  },
  disabled: { opacity: 0.64 },
  iconTile: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: { flex: 1, gap: 2 },
  title: { color: colors.text, fontWeight: '700', fontSize: scaleFont(15) },
  subtitle: { color: colors.textMuted, fontSize: scaleFont(12), lineHeight: scaleFont(17) },
  status: { fontWeight: '700', fontSize: scaleFont(12) },
  control: { minWidth: touchTarget, alignItems: 'flex-end', gap: 2 },
});
