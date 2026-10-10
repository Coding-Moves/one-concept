import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { useTheme } from '../context/ThemeContext';
import { PublicProfile } from '../services/profileSharing';
import { ProfileAvatar } from './ProfileAvatar';

/** The same allowlisted fields appear in draft review and the published-link preview. */
export function PublicProfilePreview({ profile }: { profile: PublicProfile }) {
  const { colors } = useTheme();
  const hasHighlights = profile.current_streak !== undefined || profile.concepts_learned !== undefined;
  return <View style={styles.content}>
    <Text style={[styles.brand, { color: colors.primary }]}>ONE CONCEPT</Text>
    <ProfileAvatar avatarRef={profile.avatar_ref} avatarUrl={profile.avatar_url} size={72} />
    <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>{profile.display_name || 'One Concept learner'}</Text>
    {profile.bio ? <Text style={[styles.bio, { color: colors.textSecondary }]}>{profile.bio}</Text> : null}
    {hasHighlights && <View style={styles.highlights}>
      {profile.current_streak !== undefined && <View style={[styles.highlight, { backgroundColor: colors.background }]}>
        <Ionicons name="flame-outline" size={24} color={colors.streak} />
        <Text style={[styles.number, { color: colors.text }]}>{profile.current_streak} days</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Current streak · Best {profile.longest_streak}</Text>
      </View>}
      {profile.concepts_learned !== undefined && <View style={[styles.highlight, { backgroundColor: colors.background }]}>
        <Ionicons name="library-outline" size={24} color={colors.primary} />
        <Text style={[styles.number, { color: colors.text }]}>{profile.concepts_learned}</Text>
        <Text style={[styles.copy, { color: colors.textSecondary }]}>Concepts learned</Text>
      </View>}
    </View>}
    {profile.achievements.length > 0 && <View style={styles.awards}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Achievements</Text>
      {profile.achievements.map((award, index) => <View key={index} style={[styles.award, { backgroundColor: colors.background }]}>
        <Ionicons name="ribbon-outline" size={22} color={colors.primary} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: colors.text, fontWeight: '700' }}>{award.name}</Text>
          <Text style={{ color: colors.textSecondary }}>{award.description}</Text>
        </View>
      </View>)}
    </View>}
    {!hasHighlights && !profile.achievements.length && <Text style={[styles.copy, { color: colors.textSecondary }]}>No learning highlights have been shared.</Text>}
  </View>;
}

const styles = StyleSheet.create({
  content: { width: '100%', alignItems: 'center', gap: 14 },
  brand: { fontSize: 12, letterSpacing: 2, fontWeight: '700' },
  name: { fontSize: 26, fontWeight: '700', textAlign: 'center' },
  bio: { fontSize: 15, lineHeight: 22, textAlign: 'center' },
  highlights: { width: '100%', gap: 10 },
  highlight: { padding: 16, borderRadius: 18, gap: 6 },
  number: { fontSize: 23, fontWeight: '700' },
  copy: { fontSize: 14, lineHeight: 21 },
  awards: { width: '100%', gap: 10 },
  sectionTitle: { fontSize: 17, fontWeight: '700' },
  award: { flexDirection: 'row', gap: 10, padding: 14, borderRadius: 16 },
});
