import { Ionicons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';

export const AVATAR_PRESETS = [
  ['aurora', '#6955D9', 'sparkles-outline'], ['comet', '#0D7B8C', 'rocket-outline'],
  ['forest', '#278257', 'leaf-outline'], ['ocean', '#2875C5', 'water-outline'],
  ['sunset', '#C76A2C', 'sunny-outline'], ['violet', '#8552C6', 'planet-outline'],
] as const;

export type AvatarPreset = typeof AVATAR_PRESETS[number][0];

export function ProfileAvatar({ avatarRef, avatarUrl, size = 72 }: { avatarRef?: string | null; avatarUrl?: string | null; size?: number }) {
  const { colors } = useTheme();
  const preset = AVATAR_PRESETS.find(([id]) => avatarRef === `preset:${id}`);
  const backgroundColor = preset?.[1] ?? colors.categoryChip;
  const icon = preset?.[2] ?? 'person-outline';
  return <View accessibilityLabel="Profile avatar" style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor }]}>
    {avatarUrl ? <Image source={{ uri: avatarUrl }} style={{ width: size, height: size, borderRadius: size / 2 }} /> : <Ionicons name={icon} size={size * 0.45} color={preset ? '#fff' : colors.primary} />}
  </View>;
}
const styles = StyleSheet.create({ avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' } });
