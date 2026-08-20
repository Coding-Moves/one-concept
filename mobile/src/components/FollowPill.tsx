import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors } from '../theme';

interface Props {
  following: boolean;
  onPress: () => void;
}

/** DevBytes-style follow pill: filled "+ Follow" flips to an outlined "✓ Following". */
export function FollowPill({ following, onPress }: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const scale = useRef(new Animated.Value(1)).current;

  const press = () => {
    onPress();
    scale.setValue(0.9);
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 200,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={press}
        style={({ pressed }) => [
          styles.pill,
          following ? styles.followingPill : styles.followPill,
          pressed && styles.pressed,
        ]}
        accessibilityRole="button"
        accessibilityState={{ selected: following }}
      >
        <Ionicons
          name={following ? 'checkmark' : 'add'}
          size={15}
          color={following ? colors.text : colors.background}
        />
        <Text style={[styles.label, following ? styles.followingLabel : styles.followLabel]}>
          {following ? 'Following' : 'Follow'}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.xs,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm,
      borderWidth: 1,
    },
    followPill: {
      backgroundColor: colors.text,
      borderColor: colors.text,
    },
    followingPill: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
    },
    pressed: {
      opacity: 0.75,
    },
    label: {
      fontSize: 14,
      fontWeight: '600',
    },
    followLabel: {
      color: colors.background,
    },
    followingLabel: {
      color: colors.text,
    },
  });
