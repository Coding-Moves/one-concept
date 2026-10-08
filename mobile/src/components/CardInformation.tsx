import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../context/ThemeContext';
import { reviewForConcept } from '../services/conceptMapping';
import { radius, scaleFont, scaleIcon, spacing, ThemeColors, typography } from '../theme';
import { Concept } from '../types';
import { MarkdownText } from './MarkdownText';

/** Public metadata for the exact card body on screen, including old cached cards. */
export function CardInformation({ concept }: { concept: Concept }) {
  const [visible, setVisible] = useState(false);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const review = reviewForConcept(concept);
  const version = Number.isSafeInteger(concept.contentVersion) && concept.contentVersion! > 0
    ? concept.contentVersion
    : null;

  useEffect(() => setVisible(false), [concept.id, concept.contentVersion]);

  return <>
    <Pressable
      onPress={() => setVisible(true)}
      style={({ pressed }) => [styles.control, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel="Card information"
      accessibilityHint="Shows the topic, version, and verified reviewer for this card"
    >
      <Ionicons name="ellipsis-horizontal" size={scaleIcon(22)} color={colors.primary} />
    </Pressable>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => setVisible(false)}>
      <View style={[styles.backdrop, { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg }]}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <ScrollView contentContainerStyle={styles.body}>
            <Text accessibilityRole="header" style={styles.heading}>Card information</Text>
            <Text style={styles.label}>Title</Text>
            <MarkdownText value={concept.title} style={styles.value} inline />
            <Text style={styles.label}>Topic</Text>
            <Text style={styles.value}>{concept.category}</Text>
            <Text style={styles.label}>Content version</Text>
            <Text style={styles.value}>{version ?? 'Unavailable'}</Text>
            {review ? <>
              <Text style={styles.label}>Reviewed by</Text>
              <Text style={styles.value}>{review.name}</Text>
              <Text style={styles.label}>Reviewed on</Text>
              <Text style={styles.value}>{new Date(review.reviewedAt).toLocaleDateString(undefined, {
                year: 'numeric', month: 'long', day: 'numeric',
              })}</Text>
            </> : <Text style={styles.note}>No verified reviewer is recorded for this card version.</Text>}
          </ScrollView>
          <Pressable
            onPress={() => setVisible(false)}
            style={({ pressed }) => [styles.close, pressed && styles.pressed]}
            accessibilityRole="button"
            accessibilityLabel="Close card information"
          >
            <Text style={styles.closeText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  </>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  control: {
    position: 'absolute', zIndex: 3, right: spacing.md, top: spacing.md,
    width: 44, height: 44, borderRadius: radius.pill,
    backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center',
  },
  pressed: { opacity: 0.65 },
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg,
  },
  sheet: { width: '100%', maxWidth: 420, maxHeight: '100%', borderRadius: radius.xl, backgroundColor: colors.surface, overflow: 'hidden' },
  body: { padding: spacing.lg, gap: spacing.xs },
  heading: { ...typography.title, fontSize: scaleFont(24), color: colors.text, marginBottom: spacing.md },
  label: { fontSize: scaleFont(12), fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm },
  value: { fontSize: scaleFont(16), lineHeight: scaleFont(23), color: colors.text },
  note: { fontSize: scaleFont(14), lineHeight: scaleFont(21), color: colors.textSecondary, marginTop: spacing.md },
  close: { margin: spacing.lg, marginTop: 0, minHeight: 48, borderRadius: radius.md, backgroundColor: colors.offlineBackground, alignItems: 'center', justifyContent: 'center' },
  closeText: { fontSize: scaleFont(16), fontWeight: '700', color: colors.offlineText },
});
