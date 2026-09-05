import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Constants from 'expo-constants';
import { useMemo } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { scaleIcon, scaleFont, radius, spacing, ThemeColors, typography } from '../theme';
import { ProfileStackParamList } from './ProfileScreen';

const HOW_IT_WORKS = [
  'Each day you get one concept, drawn from the topics you follow.',
  'Read it in under a minute — a plain explanation plus a concrete example.',
  'Mark it learned to keep your streak, and like or save the ones you love.',
];

const GITHUB_ORG = 'https://github.com/Coding-Moves';
const GITHUB_DEV = 'https://github.com/Muawiya-contact';
const ISSUES_URL = 'https://github.com/Coding-Moves/one-concept/issues/new';
const FEEDBACK_EMAIL = 'contactmuawia@gmail.com';

/**
 * Open a URL, falling back to an alert if nothing can handle it — most likely
 * a mailto: on a device with no mail app. The fallback shows the destination
 * (email or link) so the tap is never a dead end.
 */
function openURL(url: string, fallback: string) {
  Linking.openURL(url).catch(() => {
    Alert.alert("Couldn't open that", fallback);
  });
}

export function AboutScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParamList, 'About'>>();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const version = Constants.expoConfig?.version ?? '?';

  const contact = () => {
    const subject = encodeURIComponent(`One Concept App Feedback (v${version})`);
    openURL(`mailto:${FEEDBACK_EMAIL}?subject=${subject}`, `Reach us at ${FEEDBACK_EMAIL}`);
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.title}>About</Text>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={scaleIcon(24)} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.badge}>
          <Ionicons name="bulb" size={scaleIcon(30)} color={colors.primary} />
        </View>
        <Text style={styles.appName}>One Concept</Text>
        <Text style={styles.version}>Version {version}</Text>
      </View>

      <Text style={styles.tagline}>
        One concept a day — a small, deliberate step forward in AI, software
        engineering, computer science, mathematics, and Linux.
      </Text>

      <Text style={styles.sectionTitle}>How it works</Text>
      <View style={styles.list}>
        {HOW_IT_WORKS.map((line, i) => (
          <View key={i} style={styles.item}>
            <Ionicons name="checkmark-circle" size={scaleIcon(18)} color={colors.success} style={styles.itemIcon} />
            <Text style={styles.itemText}>{line}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.sectionTitle}>Feedback &amp; support</Text>
      <View style={styles.list}>
        <Pressable
          onPress={contact}
          style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Contact us by email"
        >
          <Ionicons name="mail-outline" size={scaleIcon(18)} color={colors.primary} style={styles.itemIcon} />
          <Text style={styles.actionText}>Have feedback or found a bug? Contact us</Text>
          <Ionicons name="chevron-forward" size={scaleIcon(18)} color={colors.textMuted} />
        </Pressable>
        <Pressable
          onPress={() => openURL(ISSUES_URL, ISSUES_URL)}
          style={({ pressed }) => [styles.actionRow, pressed && styles.pressed]}
          accessibilityRole="link"
          accessibilityLabel="Report an issue on GitHub"
        >
          <Ionicons name="logo-github" size={scaleIcon(18)} color={colors.primary} style={styles.itemIcon} />
          <Text style={styles.actionText}>Report an issue on GitHub</Text>
          <Ionicons name="chevron-forward" size={scaleIcon(18)} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.footerText}>
          Built with ❤️ by{' '}
          <Text style={styles.link} onPress={() => openURL(GITHUB_ORG, GITHUB_ORG)} accessibilityRole="link">
            Coding Moves
          </Text>
        </Text>
        <Text style={styles.footerSub}>
          Developed by{' '}
          <Text style={styles.link} onPress={() => openURL(GITHUB_DEV, GITHUB_DEV)} accessibilityRole="link">
            @Muawiya-contact
          </Text>
        </Text>
      </View>
    </ScrollView>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    content: { padding: spacing.lg, paddingBottom: spacing.xl },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: spacing.lg,
    },
    title: { ...typography.title, fontSize: scaleFont(24), color: colors.text },
    closeButton: { padding: spacing.xs },
    hero: { alignItems: 'center', gap: spacing.xs, marginBottom: spacing.lg },
    badge: {
      width: 64,
      height: 64,
      borderRadius: radius.lg,
      backgroundColor: colors.categoryChip,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    appName: { ...typography.title, fontSize: scaleFont(26), color: colors.text },
    version: { fontSize: scaleFont(13), fontWeight: '600', color: colors.textMuted },
    tagline: {
      fontSize: scaleFont(15),
      lineHeight: scaleFont(22),
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.xl,
    },
    sectionTitle: {
      ...typography.title,
      fontSize: scaleFont(18),
      color: colors.text,
      marginBottom: spacing.md,
    },
    list: { gap: spacing.md, marginBottom: spacing.xl },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    itemIcon: { marginTop: 1 },
    itemText: { flex: 1, fontSize: scaleFont(15), lineHeight: scaleFont(21), color: colors.textSecondary },
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing.sm,
      backgroundColor: colors.surface,
      borderRadius: radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: spacing.md,
    },
    pressed: { opacity: 0.7 },
    actionText: { flex: 1, fontSize: scaleFont(15), fontWeight: '600', color: colors.text },
    footer: { alignItems: 'center', gap: spacing.xs, marginTop: spacing.sm },
    footerText: { fontSize: scaleFont(13), color: colors.textMuted, textAlign: 'center' },
    footerSub: { fontSize: scaleFont(12), color: colors.textMuted, textAlign: 'center' },
    link: { color: colors.primary, fontWeight: '700' },
  });
