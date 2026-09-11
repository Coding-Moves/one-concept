import { Ionicons } from '@expo/vector-icons';
import { useIsFocused } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, AppState, Platform, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, scaleFont, spacing, typography } from '../theme';
import { PrimaryButton } from './PrimaryButton';

interface Props {
  offline: boolean;
  message: string;
  onRetry: () => void | Promise<void>;
}

/** Local artwork works without a connection and pauses offscreen or with reduced motion. */
export function UnavailableState({ offline, message, onRetry }: Props) {
  const { colors } = useTheme();
  const focused = useIsFocused();
  const [reduceMotion, setReduceMotion] = useState(true);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [retrying, setRetrying] = useState(false);
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduceMotion(value);
    }).catch(() => {});
    const motion = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    const app = AppState.addEventListener('change', (state) => setForeground(state === 'active'));
    return () => { active = false; motion.remove(); app.remove(); };
  }, []);

  useEffect(() => {
    if (reduceMotion || !focused || !foreground || !offline) return;
    const timing = (toValue: number) => Animated.timing(float, {
      toValue, duration: 1400, useNativeDriver: Platform.OS !== 'web', isInteraction: false,
    });
    const animation = Animated.loop(Animated.sequence([timing(-6), timing(0)]));
    animation.start();
    return () => { animation.stop(); float.setValue(0); };
  }, [float, reduceMotion, focused, foreground, offline]);

  const retry = async () => {
    if (retrying) return;
    setRetrying(true);
    try { await onRetry(); } finally { setRetrying(false); }
  };

  return (
    <View style={styles.container}>
      <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Animated.View style={[styles.artwork, { backgroundColor: colors.categoryChip, transform: [{ translateY: float }] }]}>
          <Ionicons name={offline ? 'cloud-offline-outline' : 'cloud-outline'} size={48} color={colors.categoryChipText} />
        </Animated.View>
      </View>
      <Text style={[styles.title, { color: colors.text }]} accessibilityRole="header">
        {offline ? 'You’re offline' : 'Couldn’t load this yet'}
      </Text>
      <Text style={[styles.message, { color: colors.textSecondary }]}>{message}</Text>
      <View style={styles.action}>
        <PrimaryButton label={retrying ? 'Trying…' : 'Try again'} onPress={retry} disabled={retrying} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl, paddingHorizontal: spacing.md },
  artwork: { width: 104, height: 104, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.sm },
  title: { ...typography.heading, textAlign: 'center' },
  message: { fontSize: scaleFont(15), lineHeight: scaleFont(22), textAlign: 'center', maxWidth: 320 },
  action: { width: '100%', maxWidth: 200, marginTop: spacing.xs },
});
