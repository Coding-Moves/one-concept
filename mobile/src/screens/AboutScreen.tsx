import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import Constants from 'expo-constants';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors, typography } from '../theme';

const HOW_IT_WORKS = [
  'Each day you get one concept, drawn from the topics you follow.',
  'Read it in under a minute — a plain explanation plus a concrete example.',
  'Mark it learned to keep your streak, and like or save the ones you love.',
];

export function AboutScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const version = Constants.expoConfig?.version ?? '?';

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
          <Ionicons name="close" size={24} color={colors.text} />
        </Pressable>
      </View>

      <View style={styles.hero}>
        <View style={styles.badge}>
          <Ionicons name="bulb" size={30} color={colors.primary} />
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
            <Ionicons name="checkmark-circle" size={18} color={colors.success} style={styles.itemIcon} />
            <Text style={styles.itemText}>{line}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.credit}>Made by Coding Moves.</Text>
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
    title: { ...typography.title, fontSize: 24, color: colors.text },
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
    appName: { ...typography.title, fontSize: 26, color: colors.text },
    version: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
    tagline: {
      fontSize: 15,
      lineHeight: 22,
      color: colors.textSecondary,
      textAlign: 'center',
      marginBottom: spacing.xl,
    },
    sectionTitle: {
      ...typography.title,
      fontSize: 18,
      color: colors.text,
      marginBottom: spacing.md,
    },
    list: { gap: spacing.md, marginBottom: spacing.xl },
    item: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
    itemIcon: { marginTop: 1 },
    itemText: { flex: 1, fontSize: 15, lineHeight: 21, color: colors.textSecondary },
    credit: { fontSize: 13, color: colors.textMuted, textAlign: 'center' },
  });
