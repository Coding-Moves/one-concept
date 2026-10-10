import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ProfileAvatar } from './ProfileAvatar';
import { RelationshipControls } from './RelationshipControls';
import { onPublicProfileOpen } from '../services/publicProfileNavigation';
import { useTheme } from '../context/ThemeContext';
import { getPublicProfile, profileTokenFromLink, PublicProfile } from '../services/profileSharing';

/** Public links work even while signed out; visitor data is never persisted. */
export function PublicProfileLink() {
  const { colors } = useTheme();
  const [token, setToken] = useState<string | null>(null);
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let receivedEvent = false;
    const receive = (url: string) => {
      const parsed = profileTokenFromLink(url);
      if (active && parsed) { setProfile(null); setError(false); setToken(parsed); setAttempt(n => n + 1); }
    };
    const stopOpening = onPublicProfileOpen(receive);
    const listener = Linking.addEventListener('url', event => { receivedEvent = true; receive(event.url); });
    Linking.getInitialURL().then(url => { if (url && !receivedEvent) receive(url); }).catch(() => {});
    return () => { active = false; listener.remove(); stopOpening(); };
  }, []);
  useEffect(() => {
    if (!token) { setProfile(null); return; }
    let current = true;
    const load = () => {
      setProfile(null); setError(false);
      if (token) getPublicProfile(token).then(data => { if (current) setProfile(data); }).catch(() => { if (current) setError(true); });
    };
    load();
    const subscription = AppState.addEventListener('change', state => {
      // Hide public data while backgrounded and revalidate on return.
      current = false; setProfile(null);
      if (state === 'active') setAttempt(n => n + 1);
    });
    return () => { current = false; subscription.remove(); };
  }, [token, attempt]);
  const close = () => { setToken(null); setProfile(null); setError(false); };
  // Unmount the portal on close so its focus trap cannot cover account screens.
  if (!token) return null;
  return <Modal visible onRequestClose={close} animationType="slide">
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable accessibilityRole="button" accessibilityLabel="Close shared profile" onPress={close} style={styles.close}>
          <Ionicons name="close" size={26} color={colors.text} />
        </Pressable>
        {error ? <><Text style={{ color: colors.text }}>This profile is unavailable or your connection could not be reached.</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 44 }}><Text style={{ color: colors.primary }}>Retry</Text></Pressable></> : profile ? <>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text style={[styles.brand, { color: colors.primary }]}>ONE CONCEPT</Text>
            <View style={styles.identity}>
              <ProfileAvatar avatarRef={profile.avatar_ref} avatarUrl={profile.avatar_url} size={76} />
              <Text accessibilityRole="header" style={[styles.name, { color: colors.text }]}>{profile.display_name || 'One Concept learner'}</Text>
            </View>
            {profile.bio ? <Text style={[styles.bio, { color: colors.textSecondary }]}>{profile.bio}</Text> : null}
            <RelationshipControls token={token} />
            {(profile.current_streak !== undefined || profile.concepts_learned !== undefined) && <View style={styles.highlights}>
              {profile.current_streak !== undefined && <View style={[styles.highlight, { backgroundColor: colors.background }]}>
                <Ionicons name="flame-outline" size={24} color={colors.streak} />
                <Text style={[styles.number, { color: colors.text }]}>{profile.current_streak} days</Text>
                <Text style={{ color: colors.textSecondary }}>Current streak · Best {profile.longest_streak}</Text>
              </View>}
              {profile.concepts_learned !== undefined && <View style={[styles.highlight, { backgroundColor: colors.background }]}>
                <Ionicons name="library-outline" size={24} color={colors.primary} />
                <Text style={[styles.number, { color: colors.text }]}>{profile.concepts_learned}</Text>
                <Text style={{ color: colors.textSecondary }}>Concepts learned</Text>
              </View>}
            </View>}
            {profile.achievements.length > 0 && <View style={styles.awards}>
              <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.text }]}>Achievements</Text>
              {profile.achievements.map((a, i) => <View key={i} style={[styles.award, { backgroundColor: colors.background }]}>
                <Ionicons name="ribbon-outline" size={24} color={colors.primary} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ color: colors.text, fontWeight: '700' }}>{a.name}</Text>
                  <Text style={{ color: colors.textSecondary }}>{a.description}</Text>
                </View>
              </View>)}
            </View>}
            {!profile.achievements.length && profile.current_streak === undefined && profile.concepts_learned === undefined && <Text style={{ color: colors.textMuted }}>No learning highlights have been shared.</Text>}
          </View>
          <Text style={[styles.footer, { color: colors.textMuted }]}>Shared with One Concept</Text>
        </> : <Text style={{ color: colors.text }}>Loading public profile…</Text>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}

const styles = StyleSheet.create({
  content: { padding: 16, paddingBottom: 48, gap: 16, alignItems: 'center' },
  close: { alignSelf: 'flex-end', minWidth: 48, minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  card: { width: '100%', maxWidth: 520, borderRadius: 28, padding: 24, gap: 22 },
  brand: { fontSize: 12, fontWeight: '800', letterSpacing: 2 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  name: { flex: 1, fontSize: 27, fontWeight: '700', lineHeight: 32 },
  bio: { fontSize: 16, lineHeight: 24 },
  highlights: { gap: 10 },
  highlight: { borderRadius: 18, padding: 16, gap: 4 },
  number: { fontSize: 24, fontWeight: '700' },
  awards: { gap: 10 },
  sectionTitle: { fontSize: 20, fontWeight: '700' },
  award: { flexDirection: 'row', gap: 12, borderRadius: 16, padding: 14 },
  footer: { textAlign: 'center', fontSize: 13 },
});
