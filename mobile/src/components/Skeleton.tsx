import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

/** A pulsing placeholder block, sized by the caller. */
export function SkeletonBlock({ style }: { style?: ViewStyle }) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.45, duration: 650, useNativeDriver: true }),
      ])
    );
    pulse.start();
    return () => pulse.stop();
  }, [opacity]);

  return <Animated.View style={[styles.block, style, { opacity }]} />;
}

/** Skeleton mirroring the ConceptCard layout, shown while progress loads. */
export function SkeletonConceptCard() {
  return (
    <View style={styles.card}>
      <SkeletonBlock style={{ width: 120, height: 24, borderRadius: radius.pill }} />
      <SkeletonBlock style={{ width: '60%', height: 26 }} />
      <SkeletonBlock style={{ width: '100%', height: 16 }} />
      <SkeletonBlock style={{ width: '100%', height: 16 }} />
      <SkeletonBlock style={{ width: '80%', height: 16 }} />
      <SkeletonBlock style={{ width: '100%', height: 72, borderRadius: radius.md }} />
    </View>
  );
}

/** Skeleton mirroring a history list row. */
export function SkeletonRow() {
  return (
    <View style={styles.row}>
      <View style={styles.rowText}>
        <SkeletonBlock style={{ width: '50%', height: 18 }} />
        <SkeletonBlock style={{ width: '30%', height: 13 }} />
      </View>
      <SkeletonBlock style={{ width: 64, height: 13 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    backgroundColor: colors.border,
    borderRadius: radius.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  rowText: {
    gap: spacing.sm,
    flex: 1,
  },
});
