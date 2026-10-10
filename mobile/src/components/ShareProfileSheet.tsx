import { Ionicons } from '@expo/vector-icons';
import { ProfileAvatar } from './ProfileAvatar';
import { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { profileQr, PublicProfile } from '../services/profileSharing';

/** The preview is the anonymous API's allowlist, never the private Progress state. */
export function ShareProfileSheet({ value, busy, onClose, onShare }: {
  value: { url: string; profile: PublicProfile } | null;
  busy: boolean;
  onClose: () => void;
  onShare: () => void;
}) {
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const matrix = useMemo(() => value ? profileQr(value.url) : null, [value]);
  const pixel = matrix ? Math.max(1, Math.min(5, Math.floor((Math.min(width, 480) - 112) / (matrix.length + 8)))) : 4;
  return <Modal visible={Boolean(value)} animationType="slide" onRequestClose={onClose}>
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={styles.header}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close share preview" onPress={onClose} style={({ pressed }) => [styles.close, { opacity: pressed ? 0.6 : 1 }]}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>Share your progress</Text>
      </View>
      {value && <ScrollView contentContainerStyle={styles.content}>
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <Text style={[styles.brand, { color: colors.primary }]}>ONE CONCEPT</Text>
          <ProfileAvatar avatarRef={value.profile.avatar_ref} avatarUrl={value.profile.avatar_url} size={72} />
          <Text style={[styles.name, { color: colors.text }]}>{value.profile.display_name || 'One Concept learner'}</Text>
          {value.profile.bio ? <Text style={[styles.copy, { color: colors.textSecondary }]}>{value.profile.bio}</Text> : null}
          <Text style={[styles.copy, { color: colors.textSecondary }]}>One concept. A little more understanding.</Text>
          <View style={styles.highlights}>
            {value.profile.current_streak !== undefined && <View style={[styles.highlight, { backgroundColor: colors.background }]}>
              <Ionicons name="flame-outline" size={24} color={colors.streak} />
              <Text style={[styles.number, { color: colors.text }]}>{value.profile.current_streak} days</Text>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>Current streak · Best {value.profile.longest_streak}</Text>
            </View>}
            {value.profile.concepts_learned !== undefined && <View style={[styles.highlight, { backgroundColor: colors.background }]}>
              <Ionicons name="library-outline" size={24} color={colors.primary} />
              <Text style={[styles.number, { color: colors.text }]}>{value.profile.concepts_learned}</Text>
              <Text style={[styles.copy, { color: colors.textSecondary }]}>Concepts learned</Text>
            </View>}
          </View>
          {value.profile.achievements.map((a, i) => <View key={i} style={styles.award}>
            <Ionicons name="ribbon-outline" size={22} color={colors.primary} />
            <Text style={{ flex: 1, color: colors.text }}>{a.name}</Text>
          </View>)}
          {matrix && <View accessible accessibilityLabel="QR code containing only your public profile link" style={{ alignSelf: 'center', backgroundColor: 'white', padding: pixel * 4, marginTop: 8 }}>
            {matrix.map((row, y) => <View key={y} style={{ flexDirection: 'row', height: pixel }}>{row.map((dark, x) => <View key={x} style={{ width: pixel, height: pixel, backgroundColor: dark ? 'black' : 'white' }} />)}</View>)}
          </View>}
          <Text style={[styles.copy, { color: colors.textSecondary }]}>Scan to view my shared profile</Text>
        </View>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Only the information you selected is shown. Sharing sends your public link.</Text>
        <Pressable accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy, busy }} onPress={onShare} style={({ pressed }) => [styles.share, { backgroundColor: pressed ? colors.primaryPressed : colors.primary, opacity: busy ? 0.5 : 1 }]}>
          <Ionicons name="share-social-outline" size={22} color={colors.onPrimary} />
          <Text style={[styles.shareText, { color: colors.onPrimary }]}>{busy ? 'Preparing link…' : 'Share profile link'}</Text>
        </Pressable>
      </ScrollView>}
    </SafeAreaView>
  </Modal>;
}
const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, gap: 8 },
  close: { minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, fontSize: 22, fontWeight: '700' },
  content: { padding: 24, gap: 22, alignItems: 'center' },
  card: { width: '100%', maxWidth: 432, padding: 24, borderRadius: 28, gap: 18, alignItems: 'center' },
  brand: { fontSize: 12, letterSpacing: 2, fontWeight: '700' },
  avatar: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 28, fontWeight: '700', textAlign: 'center' },
  copy: { textAlign: 'center', fontSize: 14, lineHeight: 21 },
  highlights: { width: '100%', gap: 10 },
  highlight: { padding: 16, borderRadius: 18, gap: 6, alignItems: 'center' },
  number: { fontSize: 24, fontWeight: '700' },
  award: { width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10 },
  share: { width: '100%', maxWidth: 432, padding: 16, borderRadius: 18, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  shareText: { flexShrink: 1, fontSize: 17, fontWeight: '700', textAlign: 'center' },
});
