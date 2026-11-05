import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { lessonResourceUrl } from '../services/lessonResources';
import { radius, scaleFont, scaleIcon, spacing, ThemeColors } from '../theme';
import type { Concept } from '../types';

/** Search external resources for the public lesson currently on screen. */
export function LessonResources({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [failed, setFailed] = useState(false);
  const videoUrl = lessonResourceUrl(concept, 'video');
  const readingUrl = lessonResourceUrl(concept, 'reading');

  useEffect(() => setFailed(false), [concept.id, concept.title, concept.category]);

  if (!videoUrl || !readingUrl) return null;

  const open = async (url: string) => {
    setFailed(false);
    try {
      await Linking.openURL(url);
    } catch {
      setFailed(true);
    }
  };

  return <View style={styles.container}>
    <Text style={styles.heading}>Continue learning</Text>
    <View style={styles.links}>
      <Pressable
        onPress={() => open(videoUrl)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        accessibilityRole="link"
        accessibilityLabel={`Find video tutorials about ${concept.title}`}
        accessibilityHint="Opens YouTube search results outside One Concept"
      >
        <Ionicons name="play-circle-outline" size={scaleIcon(20)} color={colors.primary} />
        <Text style={styles.linkText}>Video tutorials</Text>
      </Pressable>
      <Pressable
        onPress={() => open(readingUrl)}
        style={({ pressed }) => [styles.link, pressed && styles.pressed]}
        accessibilityRole="link"
        accessibilityLabel={`Find more reading about ${concept.title}`}
        accessibilityHint="Opens Google search results outside One Concept"
      >
        <Ionicons name="book-outline" size={scaleIcon(20)} color={colors.primary} />
        <Text style={styles.linkText}>Learn more</Text>
      </Pressable>
    </View>
    <Text style={styles.note}>External search results are not reviewed by One Concept.</Text>
    {failed ? <Text style={styles.error} accessibilityLiveRegion="polite">
      Couldn’t open that search. Check your browser and connection, then try again.
    </Text> : null}
  </View>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  container: { gap: spacing.sm },
  heading: { fontSize: scaleFont(14), fontWeight: '700', color: colors.text },
  links: { flexDirection: 'row', gap: spacing.sm },
  link: {
    flex: 1, minHeight: 48, paddingHorizontal: spacing.sm,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs,
    borderRadius: radius.md, backgroundColor: colors.surfaceSubtle,
  },
  linkText: { flexShrink: 1, fontSize: scaleFont(14), fontWeight: '600', color: colors.primary },
  pressed: { opacity: 0.65 },
  note: { fontSize: scaleFont(12), lineHeight: scaleFont(18), color: colors.textMuted },
  error: { fontSize: scaleFont(13), lineHeight: scaleFont(19), color: colors.danger },
});
