import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

interface Props {
  size: number;
  color: string;
  /** A dead streak shows a still flame; a live one flickers. */
  active: boolean;
}

/** The streak flame: gently flickers (scale + sway) while the streak is alive. */
export function AnimatedFlame({ size, color, active }: Props) {
  const flicker = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) {
      flicker.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(flicker, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flicker, {
          toValue: 0.3,
          duration: 260,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flicker, {
          toValue: 0.8,
          duration: 340,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(flicker, {
          toValue: 0,
          duration: 300,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, flicker]);

  const scale = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.18],
  });
  const rotate = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: ['-4deg', '5deg'],
  });
  const translateY = flicker.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -1.5],
  });

  return (
    <Animated.View style={{ transform: [{ scale }, { rotate }, { translateY }] }}>
      <Ionicons name={active ? 'flame' : 'flame-outline'} size={size} color={color} />
    </Animated.View>
  );
}
