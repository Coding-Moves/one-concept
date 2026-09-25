import { Ionicons } from '@expo/vector-icons';
import { ComponentProps } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

type Icon = ComponentProps<typeof Ionicons>['name'];
const ART: Record<string, { icon: Icon; light: string; dark: string; rings: number }> = {
  candle: { icon: 'flame-outline', light: '#9B4B13', dark: '#FFBE7B', rings: 1 },
  flame: { icon: 'flame', light: '#A33D26', dark: '#FFB29C', rings: 1 },
  spark: { icon: 'flash', light: '#826000', dark: '#F9D76D', rings: 2 },
  sun: { icon: 'sunny', light: '#8B5900', dark: '#FFD18A', rings: 2 },
  emblem: { icon: 'ribbon', light: '#6E4CA0', dark: '#CDB5FF', rings: 2 },
  compass: { icon: 'compass', light: '#1D706D', dark: '#88DED6', rings: 2 },
  star: { icon: 'star', light: '#816000', dark: '#FFE28A', rings: 3 },
  planet: { icon: 'planet', light: '#4F57A6', dark: '#BAC2FF', rings: 3 },
  universe: { icon: 'sparkles', light: '#754290', dark: '#E6B3FF', rings: 3 },
};

/** Local vector glyphs and static rings: no downloads, heavy blur or perpetual
 * particle animation. Unknown future artwork retains a usable generic badge. */
export function AchievementBadge({ artwork, locked = false, size = 88 }: {
  artwork: string; locked?: boolean; size?: number;
}) {
  const { colors, mode } = useTheme();
  const art = ART[artwork] ?? { icon: 'medal' as Icon, light: '#816000', dark: '#FFE28A', rings: 1 };
  const accent = locked ? colors.textMuted : mode === 'dark' ? art.dark : art.light;
  return (
    <View accessible={false} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
      style={[styles.outer, { width: size, height: size, borderRadius: size / 2,
        backgroundColor: locked ? colors.background : accent + '14', borderColor: accent + '40' }]}>
      {!locked && art.rings > 1 && <View style={[styles.ring, { inset: size * 0.09, borderRadius: size, borderColor: accent + '60' }]} />}
      {!locked && art.rings > 2 && <View style={[styles.ring, { inset: size * 0.16, borderRadius: size, borderColor: accent + '30' }]} />}
      <Ionicons name={locked ? 'lock-closed-outline' : art.icon} size={size * 0.43} color={accent} />
      {!locked && <View style={[styles.gem, { backgroundColor: accent, borderColor: colors.surface }]} />}
    </View>
  );
}
const styles = StyleSheet.create({
  outer: { alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  ring: { position: 'absolute', borderWidth: 1 },
  gem: { position: 'absolute', bottom: 0, width: 12, height: 12, borderRadius: 6, borderWidth: 2 },
});
