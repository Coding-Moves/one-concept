import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { openPublicProfile } from '../services/publicProfileNavigation';
import { publicProfileUrl } from '../services/profileSharing';
import { disconnectProfile, onRelationshipsChanged, relationshipError, relationshipList, RelationshipEntry } from '../services/relationships';

/** A learner controls only their own directed list; no invitations or reciprocity. */
export function ConnectionsScreen() {
  const { session } = useAuth();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  return session && focused && foreground ? <AccountConnections key={session.user.id} userId={session.user.id} /> : null;
}

function AccountConnections({ userId }: { userId: string }) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const [items, setItems] = useState<RelationshipEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [confirm, setConfirm] = useState<string | null>(null);
  const active = useRef(true);
  const revision = useRef(0);
  const reload = async (more = false) => {
    const run = ++revision.current;
    setBusy(true); setMessage(''); setConfirm(null);
    try {
      const page = await relationshipList(userId, more ? cursor ?? undefined : undefined);
      if (!active.current || run !== revision.current) return;
      setItems(old => more ? [...old, ...page.items.filter(item => !old.some(previous => previous.id === item.id))] : page.items);
      setCursor(page.next_cursor);
    } catch (error) { if (active.current && run === revision.current) setMessage(relationshipError(error)); }
    finally { if (active.current && run === revision.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void reload(); const unsubscribe = onRelationshipsChanged(() => void reload()); return () => { active.current = false; revision.current++; unsubscribe(); }; }, []);
  const disconnect = async (id: string) => {
    setBusy(true); setMessage('');
    try { await disconnectProfile(userId, id); if (active.current) { setConfirm(null); await reload(); setMessage('Disconnected.'); } }
    catch (error) { if (active.current) setMessage(relationshipError(error)); }
    finally { if (active.current) setBusy(false); }
  };
  const button = (label: string, action: () => void, disabled = busy, destructive = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', padding: 14, borderRadius: 14, backgroundColor: destructive ? colors.dangerSurface : colors.surfaceSubtle, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}><Text style={{ color: destructive ? colors.danger : colors.primary, fontWeight: '700', textAlign: 'center' }}>{label}</Text></Pressable>;
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 20 }}>
    {button('← Back', () => navigation.goBack(), false)}
    <ScreenHeader title="Connections" subtitle="Keep your own list of learners whose public profiles you chose to connect with." />
    <View style={{ gap: 12, backgroundColor: colors.surface, borderRadius: 20, padding: 18 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Find a learner</Text>
      <Text style={{ color: colors.textSecondary }}>Scan their One Concept profile QR code, or paste their shared profile link. Connect is one-way: they are not notified and do not connect back automatically.</Text>
      {button('Scan profile QR', () => navigation.navigate('ScanProfile'), false)}
      <TextInput accessibilityLabel="Shared profile link" placeholder="Paste a One Concept profile link" placeholderTextColor={colors.textMuted} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 50, padding: 14, borderRadius: 14, color: colors.text, backgroundColor: colors.surfaceSubtle }} />
      {button('Open shared profile', () => { if (!openPublicProfile(link.trim())) setMessage('Enter a valid One Concept profile link.'); }, false)}
    </View>
    <View style={{ gap: 8 }}><Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Your connections</Text><Text style={{ color: colors.textSecondary }}>Only you can see this list. Disconnect removes the learner from your list.</Text></View>
    {busy && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Loading connections…</Text>}
    {!busy && !message && !items.length && <Text style={{ color: colors.textSecondary }}>No connections yet. Scan a profile QR code or open a shared link to get started.</Text>}
    {items.map(item => <View key={item.id} style={{ backgroundColor: colors.surface, borderRadius: 20, padding: 18, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.connectionAccentSurface }}><Ionicons name="person-outline" size={24} color={colors.connectionAccent} /></View><Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: 18 }}>{item.display_name}</Text></View>
      {item.public_path ? button('View shared profile', () => openPublicProfile(publicProfileUrl(item.public_path!))) : <Text style={{ color: colors.textSecondary }}>This learner has made their profile private. You can still disconnect.</Text>}
      {confirm === item.id ? <><Text style={{ color: colors.text }}>Disconnect from this learner?</Text>{button('Confirm disconnect', () => void disconnect(item.id), busy, true)}{button('Keep connected', () => setConfirm(null), false)}</> : button('Disconnect', () => setConfirm(item.id), false, true)}
    </View>)}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
    {cursor ? button('Load more', () => void reload(true)) : null}
    {message ? button('Try again', () => void reload(), false) : null}
  </ScrollView>;
}
