import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { ThemeColors } from '../theme';

/**
 * A small "🔥 N" badge showing how many people liked a concept. Renders nothing
 * when the count is zero, so a card with no likes shows no number (issue #95).
 */
export function LikeCount({ count }: { count: number }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  if (count <= 0) return null;
  return (
    <View style={styles.row}>
      <Ionicons name="flame" size={13} color={colors.streak} />
      <Text style={styles.text}>{count}</Text>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    row: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    text: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  });
