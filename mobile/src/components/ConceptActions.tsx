import { Ionicons } from '@expo/vector-icons';
import { useMemo, useRef } from 'react';
import { Animated, Pressable, Share, StyleSheet, View } from 'react-native';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { radius, spacing, ThemeColors } from '../theme';
import { Concept } from '../types';

function usePop() {
  const scale = useRef(new Animated.Value(1)).current;
  const pop = () => {
    scale.setValue(0.7);
    Animated.spring(scale, {
      toValue: 1,
      friction: 3,
      tension: 300,
      useNativeDriver: true,
    }).start();
  };
  return { scale, pop };
}

/** Like / save / share bar under the daily concept, DevBytes-style. */
export function ConceptActions({ concept }: { concept: Concept }) {
  const { progress, toggleLike, toggleBookmark } = useProgress();
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const liked = progress.likes.includes(concept.id);
  const saved = progress.bookmarks.includes(concept.id);
  const like = usePop();
  const save = usePop();

  const onShare = async () => {
    try {
      await Share.share({
        title: concept.title,
        message: `${concept.title} — ${concept.summary}\n\nLearned with One Concept.`,
      });
    } catch {
      // Sharing unavailable on this platform (e.g. some browsers) — ignore.
    }
  };

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => {
          toggleLike(concept.id);
          like.pop();
        }}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={liked ? 'Unlike' : 'Like'}
      >
        <Animated.View style={{ transform: [{ scale: like.scale }] }}>
          <Ionicons
            name={liked ? 'flame' : 'flame-outline'}
            size={22}
            color={liked ? colors.streak : colors.textSecondary}
          />
        </Animated.View>
      </Pressable>

      <View style={styles.divider} />

      <Pressable
        onPress={() => {
          toggleBookmark(concept.id);
          save.pop();
        }}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel={saved ? 'Remove from saved' : 'Save for later'}
      >
        <Animated.View style={{ transform: [{ scale: save.scale }] }}>
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={20}
            color={saved ? colors.primary : colors.textSecondary}
          />
        </Animated.View>
      </Pressable>

      <View style={styles.divider} />

      <Pressable
        onPress={onShare}
        style={styles.action}
        accessibilityRole="button"
        accessibilityLabel="Share"
      >
        <Ionicons name="share-social-outline" size={20} color={colors.textSecondary} />
      </Pressable>
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      backgroundColor: colors.surface,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: spacing.sm,
    },
    action: {
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm + 2,
    },
    divider: {
      width: 1,
      height: 20,
      backgroundColor: colors.border,
    },
  });
