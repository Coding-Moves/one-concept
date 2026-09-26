import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, scaleFont, scaleIcon, spacing, ThemeColors } from '../theme';

interface Props {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
}

/** A stable, accessible search control for bounded on-device collections. */
export function SearchField({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
  accessibilityHint,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  return (
    <View style={styles.field}>
      <Ionicons name="search" size={scaleIcon(18)} color={colors.textMuted} accessible={false} />
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={accessibilityHint}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
      />
      {value ? (
        <Pressable
          onPress={() => onChangeText('')}
          style={({ pressed }) => [styles.clear, pressed && styles.clearPressed]}
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          hitSlop={4}
        >
          <Ionicons name="close-circle" size={scaleIcon(18)} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    field: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      paddingLeft: spacing.md,
      paddingRight: spacing.xs,
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    input: {
      flex: 1,
      minWidth: 0,
      paddingVertical: 0,
      fontSize: scaleFont(15),
      lineHeight: scaleFont(20),
      color: colors.text,
    },
    clear: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.pill,
    },
    clearPressed: { backgroundColor: colors.categoryChip },
  });
