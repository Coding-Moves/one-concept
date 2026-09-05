import { Ionicons } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConceptActions } from '../components/ConceptActions';
import { ConceptCard } from '../components/ConceptCard';
import { useTheme } from '../context/ThemeContext';
import { CONCEPTS } from '../data/concepts';
import { fetchConcept } from '../services/conceptApi';
import { RootStackParamList } from '../navigation';
import { scaleFont, scaleIcon, spacing, ThemeColors, typography } from '../theme';
import { Concept } from '../types';

const CONCEPTS_BY_ID = new Map(CONCEPTS.map((c) => [c.id, c]));

type Status = 'loading' | 'ready' | 'error';

/** Full-concept modal opened from a History or Saved card. */
export function ConceptDetailScreen() {
  const navigation = useNavigation();
  const { params } = useRoute<RouteProp<RootStackParamList, 'ConceptDetail'>>();
  const { conceptId, title } = params;
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [concept, setConcept] = useState<Concept | null>(null);
  const [status, setStatus] = useState<Status>('loading');

  useEffect(() => {
    let active = true;
    setStatus('loading');
    fetchConcept(conceptId)
      .then((c) => {
        if (active) {
          setConcept(c);
          setStatus('ready');
        }
      })
      .catch(() => {
        // Offline or not found: the bundled catalog covers the signed-out demo
        // set; anything else we can't show, so say so rather than hang.
        const local = CONCEPTS_BY_ID.get(conceptId);
        if (!active) return;
        if (local) {
          setConcept(local);
          setStatus('ready');
        } else {
          setStatus('error');
        }
      });
    return () => {
      active = false;
    };
  }, [conceptId]);

  return (
    <View style={styles.screen}>
      <View style={styles.topBar}>
        <Text style={styles.heading} numberOfLines={1}>
          {title ?? 'Concept'}
        </Text>
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.closeButton, pressed && { opacity: 0.6 }]}
          accessibilityRole="button"
          accessibilityLabel="Close"
        >
          <Ionicons name="close" size={scaleIcon(24)} color={colors.text} />
        </Pressable>
      </View>

      {status === 'loading' ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : status === 'error' || !concept ? (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={scaleIcon(40)} color={colors.textMuted} />
          <Text style={styles.errorTitle}>Couldn’t load this concept</Text>
          <Text style={styles.errorText}>Check your connection and try again.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <ConceptCard concept={concept} />
          <ConceptActions concept={concept} />
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    topBar: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: spacing.md,
      padding: spacing.lg,
    },
    heading: { ...typography.title, fontSize: scaleFont(22), color: colors.text, flexShrink: 1 },
    closeButton: { padding: spacing.xs },
    content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl, gap: spacing.md },
    center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.xl },
    errorTitle: { fontSize: scaleFont(17), fontWeight: '700', color: colors.text },
    errorText: { fontSize: scaleFont(14), color: colors.textMuted, textAlign: 'center' },
  });
