import { useMemo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { reviewForConcept } from '../services/conceptMapping';
import { scaleFont, ThemeColors } from '../theme';
import { Concept } from '../types';

/** Historical editorial credit for this body, never a live account-status badge. */
export function ReviewAttribution({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const review = reviewForConcept(concept);
  if (!review) return null;
  return <Text style={styles.text}>
    Reviewed by {review.name}
  </Text>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  text: { color: colors.textSecondary, fontSize: scaleFont(13), lineHeight: scaleFont(20), flexShrink: 1 },
});
