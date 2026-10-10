import { Ionicons } from '@expo/vector-icons';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { PublicProfile } from '../services/profileSharing';
import { PublicProfilePreview } from './PublicProfilePreview';

export type PublicProfileFields = {
  displayName: boolean;
  avatar?: boolean;
  bio: boolean;
  streak: boolean;
  concepts: boolean;
  achievements: boolean;
};

/** A local review step: no public URL exists until the learner explicitly publishes. */
export function ProfilePublishReviewSheet({
  visible,
  fields,
  profile,
  busy,
  online,
  title,
  confirmLabel,
  onClose,
  onConfirm,
}: {
  visible: boolean;
  fields: PublicProfileFields;
  profile: PublicProfile;
  busy: boolean;
  online: boolean;
  title: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { colors } = useTheme();
  const selected = (Object.keys(fields) as (keyof PublicProfileFields)[]).filter(key => fields[key]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
      <SafeAreaView style={[styles.backdrop, { backgroundColor: colors.background }]}>
        <View style={[styles.sheet, { backgroundColor: colors.background }]}>
          <View style={styles.header}>
            <View style={[styles.icon, { backgroundColor: colors.primaryAccentSurface }]}>
              <Ionicons name="eye-outline" size={24} color={colors.primary} />
            </View>
            <View style={styles.headerCopy}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
              <Text style={[styles.subtitle, { color: colors.textSecondary }]}>See what visitors will see before you publish.</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Close profile sharing review" disabled={busy} onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={24} color={colors.text} />
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.content}>
            <View style={[styles.notice, { backgroundColor: colors.surfaceSubtle }]}>
              <Ionicons name="shield-checkmark-outline" size={20} color={colors.success} />
              <Text style={[styles.noticeText, { color: colors.text }]}>Your email, saved concepts, and private activity stay private.</Text>
            </View>
            <Text style={[styles.sectionTitle, { color: colors.text }]}>Visitor preview</Text>
            <View style={[styles.preview, { backgroundColor: colors.surface }]}>
              <PublicProfilePreview profile={profile} />
            </View>
            {!selected.length && <Text style={[styles.empty, { color: colors.textSecondary }]}>Choose at least one item before publishing your profile.</Text>}
            <Text style={[styles.subtitle, { color: colors.textSecondary }]}>Learning counts may change as you make progress.</Text>
            {!online && <Text accessibilityLiveRegion="polite" style={[styles.subtitle, { color: colors.textSecondary }]}>Connect to the internet to publish.</Text>}
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !selected.length || !online, busy }}
              disabled={busy || !selected.length || !online}
              onPress={onConfirm}
              style={({ pressed }) => [styles.primary, { backgroundColor: colors.primary, opacity: busy || !selected.length || !online ? 0.5 : pressed ? 0.8 : 1 }]}
            >
              <Text style={[styles.primaryText, { color: colors.onPrimary }]}>{busy ? 'Saving…' : confirmLabel}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={busy} onPress={onClose} style={styles.secondary}>
              <Text style={[styles.secondaryText, { color: colors.primary }]}>Keep editing</Text>
            </Pressable>
          </ScrollView>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 20, gap: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1, gap: 3 },
  title: { fontSize: 21, fontWeight: '700' },
  subtitle: { fontSize: 14, lineHeight: 20 },
  close: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  content: { gap: 12, paddingBottom: 8 },
  notice: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 14, alignItems: 'flex-start' },
  noticeText: { flex: 1, fontSize: 14, lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginTop: 4 },
  preview: { borderRadius: 20, padding: 20 },
  empty: { fontSize: 14, lineHeight: 20, padding: 14 },
  primary: { minHeight: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  primaryText: { fontSize: 16, fontWeight: '700' },
  secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '700' },
});
