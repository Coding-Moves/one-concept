import { useEffect, useRef } from 'react';
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Achievement } from '../services/achievementStore';
import { scaleFont, spacing, radius, typography } from '../theme';
import { AchievementBadge } from './AchievementBadge';

export function AchievementDetail({ award, onClose, celebration = false, count = 1 }: {
  award: Achievement; onClose: () => void; celebration?: boolean; count?: number;
}) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const reveal = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduced || !celebration) { reveal.setValue(1); return; }
    reveal.setValue(0.92);
    const animation = Animated.timing(reveal, { toValue: 1, duration: 240, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [celebration, reduced, reveal]);
  // A calendar day is not a UTC instant: formatting via a local Date can show
  // the previous day in western timezones. Display the saved date verbatim.
  return (
    <Modal transparent visible animationType={reduced ? 'none' : 'fade'} onRequestClose={onClose}>
      <View style={[styles.backdrop, { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.sheet, { backgroundColor: colors.surface, borderColor: colors.border }]} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.body}>
            <Text accessibilityRole="header" style={[styles.eyebrow, { color: colors.textSecondary }]}>
              {celebration ? count > 1 ? `${count} achievements earned` : 'Achievement unlocked' : 'Your achievement'}
            </Text>
            <Animated.View style={{ transform: [{ scale: reveal }] }}>
              <AchievementBadge artwork={award.artwork_key} size={128} />
            </Animated.View>
            <Text style={[styles.title, { color: colors.text }]}>{award.name}</Text>
            <Text style={[styles.days, { color: colors.text }]}>{award.threshold.toLocaleString()} consecutive days</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>{award.description}</Text>
            <Text style={[styles.copy, { color: colors.textSecondary }]}>Earned {award.earned_on}</Text>
            <View style={[styles.note, { backgroundColor: colors.background }]}>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>
                {count > 1 ? 'Your previous learning counts. All earned badges are waiting in your collection.' : 'Earned by completing daily lessons or reviews. This badge is yours to keep, even if your streak ends.'}
              </Text>
            </View>
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel={celebration ? 'Continue learning' : 'Close achievement'}
            onPress={onClose} style={({ pressed }) => [styles.button, { backgroundColor: colors.offlineBackground, opacity: pressed ? 0.85 : 1 }]}>
            <Text style={[styles.buttonText, { color: colors.offlineText }]}>{celebration ? 'Continue' : 'Done'}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 20 },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '100%', borderRadius: radius.xl, borderWidth: 1, overflow: 'hidden' },
  body: { alignItems: 'center', padding: spacing.lg, gap: spacing.md },
  eyebrow: { fontSize: scaleFont(13), fontWeight: '700', textAlign: 'center' },
  title: { ...typography.title, fontSize: scaleFont(28), textAlign: 'center' },
  days: { fontSize: scaleFont(18), fontWeight: '600', textAlign: 'center' },
  copy: { fontSize: scaleFont(14), lineHeight: scaleFont(21), textAlign: 'center' },
  note: { padding: spacing.md, borderRadius: radius.md, width: '100%' },
  button: { margin: spacing.md, marginTop: 0, padding: spacing.md, minHeight: 48, borderRadius: radius.md, alignItems: 'center' },
  buttonText: { color: '#FFFFFF', fontWeight: '700', fontSize: scaleFont(16) },
});
