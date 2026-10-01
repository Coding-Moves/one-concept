import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { ScreenHeader } from '../components/ScreenHeader';
import { actOnConnection, connectionError, connectionList, ConnectionEntry, ConnectionKind, ConnectionPreferences, connectionSettings, onConnectionsChanged, saveConnectionSettings, unblockConnection } from '../services/connections';
import { openPublicProfile } from '../services/publicProfileNavigation';
import { publicProfileUrl } from '../services/profileSharing';

export function ConnectionsScreen() {
  const { session } = useAuth();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState !== 'background');
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  return session && focused && foreground ? <AccountConnections key={session.user.id} userId={session.user.id} /> : null;
}
function AccountConnections({ userId }: { userId: string }) {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const [kind, setKind] = useState<ConnectionKind>('accepted');
  const [items, setItems] = useState<ConnectionEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<ConnectionPreferences | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [confirm, setConfirm] = useState<{id:string; action:'remove'|'block'} | null>(null);
  const active = useRef(true), pending = useRef(false), revision = useRef(0);
  const reload = async (more = false) => {
    const run = ++revision.current;
    setBusy(true); setMessage(''); setConfirm(null);
    if (!more) { setItems([]); setCursor(null); }
    try {
      const [settings, page] = await Promise.all([connectionSettings(userId), connectionList(userId, kind, more ? cursor ?? undefined : undefined)]);
      if (!active.current || run !== revision.current) return false;
      setPrefs(settings); setItems(old => more ? [...old, ...page.items.filter(item => !old.some(o => o.id === item.id))] : page.items); setCursor(page.next_cursor);
      return true;
    } catch (error) { if (active.current && run === revision.current) setMessage(connectionError(error)); return false; }
    finally { if (active.current && run === revision.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void reload(); const stop = onConnectionsChanged(() => void reload()); return () => { active.current = false; revision.current++; stop(); }; }, [kind]);
  const mutate = async (operation: () => Promise<unknown>, success: string) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      await operation();
      if (!active.current) return;
      const loaded = await reload();
      if (active.current && loaded) setMessage(success);
    } catch (error) { if (active.current) setMessage(connectionError(error)); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const button = (label: string, action: () => void, disabled = busy) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={({ pressed }) => ({ minHeight: 48, padding: 14, borderRadius: 14, backgroundColor: colors.surfaceSubtle, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}><Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text></Pressable>;
  const act = (id: string, verb: 'accept'|'decline'|'cancel'|'remove'|'block') => void mutate(() => actOnConnection(userId, id, verb), 'Connection updated.');
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 20 }}>
    {button('← Back', () => navigation.goBack(), false)}
    <ScreenHeader title="Connections" subtitle="Learn alongside people you choose. Your list is private." />
    <View style={{ padding: 18, borderRadius: 22, backgroundColor: colors.surface, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={{ flex: 1, color: colors.text, fontWeight: '700' }}>Accept new requests</Text><Switch accessibilityLabel="Accept new connection requests" value={prefs?.accepting_requests ?? false} disabled={busy || !prefs} onValueChange={accepting_requests => { if (prefs) void mutate(() => saveConnectionSettings(userId, { ...prefs, accepting_requests }), 'Request preference saved.'); }} /></View>
      <Text style={{ color: colors.textSecondary }}>People with your shared profile can ask to connect when this is on. You decide whether to accept. Public profile sharing must also be enabled.</Text>
    </View>
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Add a connection</Text>
      <TextInput accessibilityLabel="Shared profile link" placeholder="Paste a One Concept profile link" placeholderTextColor={colors.textMuted} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 50, padding: 14, borderRadius: 14, color: colors.text, backgroundColor: colors.surface }} />
      {button('Open shared profile', () => { if (!openPublicProfile(link.trim())) setMessage('Enter a valid One Concept profile link or scan its QR with your phone camera.'); }, false)}
    </View>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {([['accepted','My connections'],['incoming','Incoming requests'],['outgoing','Sent requests'],['blocked','Blocked learners']] as [ConnectionKind,string][]).map(([value,label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: kind===value, disabled: busy }} disabled={busy} onPress={() => setKind(value)} style={({ pressed }) => ({ padding: 12, minHeight: 48, borderRadius: 14, backgroundColor: kind===value ? colors.primary : colors.surface, opacity: pressed ? 0.7 : 1 })}><Text style={{ color: kind===value ? colors.onPrimary : colors.text }}>{label}</Text></Pressable>)}
    </View>
    {busy && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Loading connections…</Text>}
    {!busy && !message && !items.length && <Text style={{ color: colors.textSecondary }}>{kind==='accepted' ? 'No connections yet. Open a shared profile to send your first request.' : kind==='incoming' ? 'No incoming requests.' : kind==='outgoing' ? 'No pending sent requests.' : 'No blocked learners.'}</Text>}
    {items.map(item => <View key={item.id} style={{ backgroundColor: colors.surface, borderRadius: 22, padding: 18, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.categoryChip }}><Ionicons name="person-outline" size={24} color={colors.primary} /></View><Text style={{ flex: 1, color: colors.text, fontWeight: '700', fontSize: 18 }}>{item.display_name}</Text></View>
      {item.public_path && button('View shared profile', () => openPublicProfile(publicProfileUrl(item.public_path!)))}
      {kind==='incoming' && <>{button('Accept request', () => act(item.id,'accept'))}{button('Decline request', () => act(item.id,'decline'))}</>}
      {kind==='outgoing' && button('Cancel request', () => act(item.id,'cancel'))}
      {kind==='accepted' && button('Remove connection', () => setConfirm({id:item.id,action:'remove'}))}
      {kind!=='blocked' && button('Block learner', () => setConfirm({id:item.id,action:'block'}))}
      {kind==='blocked' && <><Text style={{ color: colors.textSecondary }}>Unblocking allows future requests. It does not restore a connection.</Text>{button('Unblock learner', () => void mutate(() => unblockConnection(userId,item.id), 'Learner unblocked.'))}</>}
      {confirm?.id === item.id && <><Text style={{ color: colors.text }}>Confirm {confirm.action}? This removes the current connection or request. New requests wait seven days; public links remain public.</Text>{button(`Confirm ${confirm.action}`, () => act(item.id,confirm.action))}{button('Keep current connection', () => setConfirm(null))}</>}
    </View>)}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
    {cursor && button('Load more', () => void reload(true))}
    {button('Reload connections', () => void reload())}
  </ScrollView>;
}
