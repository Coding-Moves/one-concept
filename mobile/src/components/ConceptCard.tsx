import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { scaleFont, radius, spacing, ThemeColors } from '../theme';
import { Concept } from '../types';
import { CategoryChip } from './CategoryChip';
import { Surface } from './Surface';

const FLIP_DURATION_MS = 280;

function Front({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return <>
    <CategoryChip category={concept.category} />
    <Text style={styles.title}>{concept.title}</Text>
    <Text style={styles.summary}>{concept.summary}</Text>
    {concept.example ? <View style={styles.exampleBox}>
      <Text style={styles.exampleLabel}>Example</Text>
      <Text style={styles.exampleText}>{concept.example}</Text>
    </View> : null}
  </>;
}

function Recall({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const flashcard = concept.flashcard!;
  return <>
    <Text style={styles.recallLabel}>Quick recall</Text>
    <Text style={styles.recallPrompt}>{flashcard.front}</Text>
    <View style={styles.answerBox}>
      <Text style={styles.exampleLabel}>Answer</Text>
      <Text style={styles.answerText}>{flashcard.back}</Text>
    </View>
  </>;
}

/** The daily digest stays readable; reviewed recall content is an optional flip. */
export function ConceptCard({ concept }: { concept: Concept }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const reducedMotion = useReducedMotion();
  const flip = useRef(new Animated.Value(0)).current;
  const [showingAnswer, setShowingAnswer] = useState(false);
  const hasFlashcard = Boolean(concept.flashcard);

  useEffect(() => {
    flip.setValue(0);
    setShowingAnswer(false);
  }, [concept.id, flip]);

  const toggleFlashcard = () => {
    const next = !showingAnswer;
    setShowingAnswer(next);
    if (reducedMotion) {
      flip.setValue(next ? 1 : 0);
      return;
    }
    Animated.timing(flip, {
      toValue: next ? 1 : 0,
      duration: FLIP_DURATION_MS,
      useNativeDriver: true,
    }).start();
  };

  if (!hasFlashcard) return <Surface style={styles.card}><Front concept={concept} /></Surface>;

  const frontRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] });
  const backRotate = flip.interpolate({ inputRange: [0, 1], outputRange: ['180deg', '360deg'] });
  return <Surface style={[styles.card, styles.flashcard]}>
    <Pressable
      onPress={toggleFlashcard}
      style={styles.flipControl}
      accessibilityRole="button"
      accessibilityLabel={showingAnswer ? 'Show lesson' : 'Show recall answer'}
      accessibilityHint={showingAnswer ? 'Shows the daily lesson side' : 'Shows the recall question and answer'}
    >
      <Ionicons name="sync-outline" size={20} color={colors.primary} />
    </Pressable>
    <Animated.View
      style={[styles.face, { transform: [{ perspective: 900 }, { rotateY: frontRotate }] }]}
      accessible={!showingAnswer}
      accessibilityLabel="Showing daily lesson"
    ><Front concept={concept} /></Animated.View>
    <Animated.View
      style={[styles.face, styles.backFace, { transform: [{ perspective: 900 }, { rotateY: backRotate }] }]}
      accessible={showingAnswer}
      accessibilityLabel="Showing recall answer"
    ><ScrollView style={styles.backScroll} nestedScrollEnabled><Recall concept={concept} /></ScrollView></Animated.View>
  </Surface>;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  card: { borderRadius: radius.xl, gap: spacing.md },
  flashcard: { minHeight: 340, position: 'relative' },
  face: { gap: spacing.md, backfaceVisibility: 'hidden' },
  backFace: { position: 'absolute', left: spacing.lg, right: spacing.lg, top: spacing.lg, bottom: spacing.lg },
  backScroll: { flex: 1 },
  flipControl: { position: 'absolute', zIndex: 2, right: spacing.md, top: spacing.md, width: 44, height: 44, borderRadius: radius.pill, backgroundColor: colors.surfaceSubtle, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: scaleFont(24), lineHeight: scaleFont(30), fontFamily: 'SpaceGrotesk_700Bold', color: colors.text, paddingRight: 48 },
  summary: { fontSize: scaleFont(16), lineHeight: scaleFont(26), color: colors.textSecondary },
  exampleBox: { backgroundColor: colors.surfaceSubtle, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  exampleLabel: { fontSize: scaleFont(11), fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.categoryChipText },
  exampleText: { fontSize: scaleFont(14.5), lineHeight: scaleFont(22), color: colors.textSecondary },
  recallLabel: { fontSize: scaleFont(11), fontWeight: '700', letterSpacing: 1.2, textTransform: 'uppercase', color: colors.categoryChipText, paddingRight: 48 },
  recallPrompt: { fontSize: scaleFont(22), lineHeight: scaleFont(29), fontFamily: 'SpaceGrotesk_700Bold', color: colors.text },
  answerBox: { backgroundColor: colors.surfaceSubtle, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  answerText: { fontSize: scaleFont(15), lineHeight: scaleFont(23), color: colors.textSecondary },
});
