import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ProfileAvatar } from '../components/ProfileAvatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useOnline } from '../context/ConnectivityContext';
import { useTheme } from '../context/ThemeContext';
import { openPublicProfile } from '../services/publicProfileNavigation';
import { publicProfileUrl } from '../services/profileSharing';
import { blockRelationship, disconnectProfile, onRelationshipsChanged, relationshipError, relationshipList, RelationshipEntry } from '../services/relationships';

/** The list remounts for each signed-in account and after backgrounding. */
export function ConnectionsScreen() {
  const { session } = useAuth();
  const focused = useIsFocused();
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  useEffect(() => { const subscription = AppState.addEventListener('change', state => setForeground(state === 'active')); return () => subscription.remove(); }, []);
  return session && focused && foreground ? <AccountConnections key={session.user.id} userId={session.user.id} /> : null;
}

type ConfirmAction = { id: string; kind: 'disconnect' | 'block' };

function AccountConnections({ userId }: { userId: string }) {
  const navigation = useNavigation<any>();
  const { colors } = useTheme();
  const online = useOnline();
  const [items, setItems] = useState<RelationshipEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState('');
  const [link, setLink] = useState('');
  const [showLink, setShowLink] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null);
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
      setLoaded(true);
    } catch (error) { if (active.current && run === revision.current) setMessage(relationshipError(error)); }
    finally { if (active.current && run === revision.current) setBusy(false); }
  };
  useEffect(() => {
    active.current = true; void reload();
    const unsubscribe = onRelationshipsChanged(() => void reload());
    return () => { active.current = false; revision.current++; unsubscribe(); };
  }, []);

  const changeConnection = async (choice: ConfirmAction) => {
    if (busy || !online) return;
    setBusy(true); setMessage('');
    try {
      if (choice.kind === 'block') await blockRelationship(userId, choice.id);
      else await disconnectProfile(userId, choice.id);
      if (!active.current) return;
      setMenu(null); setConfirm(null);
      await reload();
      if (active.current) setMessage(choice.kind === 'block' ? 'Learner blocked.' : 'Disconnected.');
    } catch (error) { if (active.current) setMessage(relationshipError(error)); }
    finally { if (active.current) setBusy(false); }
  };
  const openLink = () => {
    if (!openPublicProfile(link.trim())) setMessage('Paste a valid One Concept profile link.');
    else { setMessage(''); setShowLink(false); setLink(''); }
  };
  const button = (label: string, action: () => void, primary = false, disabled = busy || !online) => <Pressable
    accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action}
    style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 14,
      borderRadius: 14, backgroundColor: primary ? colors.primary : colors.surfaceSubtle, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}>
    <Text style={{ color: primary ? colors.onPrimary : colors.primary, fontWeight: '700', textAlign: 'center' }}>{label}</Text>
  </Pressable>;

  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 20 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>← Back</Text></Pressable>
    <ScreenHeader title="Connections" subtitle="People you choose to keep up with." />
    <View style={{ gap: 12, padding: 18, borderRadius: 20, backgroundColor: colors.surface }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 19, fontWeight: '700' }}>Find a friend</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <View style={{ flexGrow: 1, flexBasis: 125 }}>{button('Scan profile QR', () => navigation.navigate('ScanProfile'), true, busy)}</View>
        <View style={{ flexGrow: 1, flexBasis: 125 }}>{button('Open shared link', () => { setShowLink(value => !value); setMessage(''); }, false, busy)}</View>
      </View>
      {showLink ? <View style={{ gap: 10 }}>
        <TextInput accessibilityLabel="Shared profile link" placeholder="Paste your friend's profile link" placeholderTextColor={colors.textMuted} value={link} onChangeText={setLink} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 50, padding: 14, borderRadius: 14, color: colors.text, backgroundColor: colors.surfaceSubtle }} />
        {button('Open profile link', openLink)}
      </View> : null}
      <Text style={{ color: colors.textSecondary, lineHeight: 19 }}>Connecting adds someone to your list. It does not notify them.</Text>
    </View>
    <View style={{ gap: 4 }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 20, fontWeight: '700' }}>Your connections</Text>
      {items.length > 0 ? <Text style={{ color: colors.textSecondary }}>{items.length} {items.length === 1 ? 'learner' : 'learners'}</Text> : null}
    </View>
    {!online ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>Connect to load or change your connections.</Text> : null}
    {busy && !items.length ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Loading connections…</Text> : null}
    {!busy && loaded && !items.length ? <View style={{ padding: 20, borderRadius: 20, backgroundColor: colors.surface, gap: 8 }}>
      <Ionicons name="people-outline" size={30} color={colors.primary} />
      <Text style={{ color: colors.text, fontWeight: '700', fontSize: 17 }}>No connections yet</Text>
      <Text style={{ color: colors.textSecondary, lineHeight: 20 }}>Scan a friend's QR code or open their profile link to connect.</Text>
    </View> : null}
    {items.map(item => <View key={item.id} style={{ padding: 16, borderRadius: 20, backgroundColor: colors.surface, gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <ProfileAvatar avatarRef={item.avatar_ref} avatarUrl={item.avatar_url} size={48} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>{item.display_name}</Text>
          {!item.public_path ? <Text style={{ color: colors.textSecondary }}>Profile is private</Text> : null}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {item.public_path ? <View style={{ flexGrow: 1, flexBasis: 145 }}>{button('View profile', () => openPublicProfile(publicProfileUrl(item.public_path!)), true)}</View> : null}
        <View style={{ flexGrow: 1, flexBasis: 110 }}>{button(menu === item.id ? 'Hide options' : 'More options', () => { setMenu(menu === item.id ? null : item.id); setConfirm(null); }, false, busy)}</View>
      </View>
      {menu === item.id ? <View style={{ gap: 10, paddingTop: 4 }}>
        {confirm?.id === item.id ? <View accessibilityRole="alert" style={{ gap: 10, padding: 12, borderRadius: 14, backgroundColor: colors.dangerSurface }}>
          <Text style={{ color: colors.text, lineHeight: 20 }}>{confirm.kind === 'block' ? 'Block this learner? You will both disappear from each other’s lists.' : 'Disconnect from this learner?'}</Text>
          {button(confirm.kind === 'block' ? 'Confirm block' : 'Confirm disconnect', () => void changeConnection(confirm), false, busy || !online)}
          {button('Cancel', () => setConfirm(null), false, false)}
        </View> : <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flexGrow: 1, flexBasis: 110 }}>{button('Disconnect', () => setConfirm({ id: item.id, kind: 'disconnect' }), false, busy)}</View>
          <View style={{ flexGrow: 1, flexBasis: 110 }}>{button('Block', () => setConfirm({ id: item.id, kind: 'block' }), false, busy)}</View>
        </View>}
      </View> : null}
    </View>)}
    {cursor ? button('Load more', () => void reload(true)) : null}
    {message ? <View accessibilityLiveRegion="polite" style={{ gap: 8, padding: 14, borderRadius: 14, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.text }}>{message}</Text>
      {message.startsWith('Could not') ? button('Try again', () => void reload(), false, !online) : null}
    </View> : null}
  </ScrollView>;
}
