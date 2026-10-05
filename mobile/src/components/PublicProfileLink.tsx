import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
  return <Modal visible={Boolean(token)} onRequestClose={() => setToken(null)} animationType="slide">
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
        <Pressable accessibilityRole="button" onPress={() => setToken(null)} style={{ minHeight: 44 }}><Text style={{ color: colors.primary }}>Close profile</Text></Pressable>
        {error ? <><Text style={{ color: colors.text }}>This profile is unavailable or your connection could not be reached.</Text><Pressable accessibilityRole="button" onPress={() => setAttempt(n => n + 1)} style={{ minHeight: 44 }}><Text style={{ color: colors.primary }}>Retry</Text></Pressable></> : profile ? <>
          <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 28, fontWeight: '700' }}>{profile.display_name || 'One Concept learner'}</Text>
          {profile.current_streak !== undefined && <Text style={{ color: colors.text }}>Current streak: {profile.current_streak} days · Longest: {profile.longest_streak} days</Text>}
          {profile.concepts_learned !== undefined && <Text style={{ color: colors.text }}>{profile.concepts_learned} concepts learned</Text>}
          {profile.achievements.map((a, i) => <Text key={i} style={{ color: colors.text }}>{a.name} — {a.description}</Text>)}
          {!profile.achievements.length && profile.current_streak === undefined && profile.concepts_learned === undefined && <Text style={{ color: colors.textMuted }}>No learning highlights have been shared.</Text>}
          <Text style={{ color: colors.textMuted }}>Shared with One Concept</Text>
          {token && <RelationshipControls token={token} />}
        </> : <Text style={{ color: colors.text }}>Loading public profile…</Text>}
      </ScrollView>
    </SafeAreaView>
  </Modal>;
}
