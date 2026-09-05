import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { WhatsNewEntry } from '../data/whatsNew';
import { radius, shadows, spacing, ThemeColors, typography } from '../theme';

interface Props {
  entry: WhatsNewEntry;
  onDismiss: () => void;
}

/**
 * A small, one-time card announcing what changed in the new version. Dismissible
 * by the button, the close icon, tapping outside, or the Android back button.
 * Animation is a light fade + slide-up using the built-in Animated API — no
 * extra dependencies, no ongoing cost once settled.
 */
export function WhatsNewCard({ entry, onDismiss }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  // Only the slide is animated here; the Modal's animationType="fade" already
  // handles the opacity, so animating opacity again would double it up.
  const cardStyle = {
    transform: [
      {
        translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }),
      },
    ],
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onDismiss}>
      <Pressable style={styles.backdrop} onPress={onDismiss} accessibilityLabel="Dismiss">
        {/* Stop taps on the card itself from dismissing. */}
        <Pressable onPress={() => {}} style={styles.cardWrap}>
          <Animated.View style={[styles.card, cardStyle]}>
            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [styles.close, pressed && { opacity: 0.6 }]}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={8}
            >
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>

            <View style={styles.badge}>
              <Ionicons name="sparkles" size={20} color={colors.primary} />
            </View>

            <Text style={styles.title}>What's new</Text>
            <Text style={styles.version}>Version {entry.version}</Text>

            <View style={styles.list}>
              {entry.highlights.map((line, i) => (
                <View key={i} style={styles.item}>
                  <Ionicons
                    name="checkmark-circle"
                    size={18}
                    color={colors.success}
                    style={styles.itemIcon}
                  />
                  <Text style={styles.itemText}>{line}</Text>
                </View>
              ))}
            </View>

            <Pressable
              onPress={onDismiss}
              style={({ pressed }) => [styles.button, pressed && { backgroundColor: colors.primaryPressed }]}
              accessibilityRole="button"
              accessibilityLabel="Got it"
            >
              <Text style={styles.buttonText}>Got it</Text>
            </Pressable>
          </Animated.View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing.lg,
    },
    cardWrap: {
      width: '100%',
      maxWidth: 420,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: radius.xl,
      borderWidth: 1,
      borderColor: colors.border,
      padding: spacing.lg,
      ...shadows.card,
    },
    close: {
      position: 'absolute',
      top: spacing.md,
      right: spacing.md,
      zIndex: 1,
      padding: spacing.xs,
    },
    badge: {
      width: 44,
      height: 44,
      borderRadius: radius.md,
      backgroundColor: colors.categoryChip,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.md,
    },
    title: {
      ...typography.title,
      fontSize: 24,
      color: colors.text,
    },
    version: {
      fontSize: 13,
      fontWeight: '600',
      color: colors.textMuted,
      marginTop: 2,
      marginBottom: spacing.lg,
    },
    list: {
      gap: spacing.md,
      marginBottom: spacing.lg,
    },
    item: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: spacing.sm,
    },
    itemIcon: {
      marginTop: 1,
    },
    itemText: {
      flex: 1,
      ...typography.body,
      fontSize: 15,
      color: colors.textSecondary,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: radius.md,
      paddingVertical: spacing.md,
      alignItems: 'center',
    },
    buttonText: {
      color: colors.onPrimary,
      fontSize: 16,
      fontWeight: '700',
    },
  });
