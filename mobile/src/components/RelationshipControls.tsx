import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { blockProfileConnection, connectProfile, disconnectProfile, relationshipError, relationshipsChanged, relationshipStatus, RelationshipStatus } from '../services/relationships';

/** Directed Connect actions for a public profile. A tap never creates a reciprocal relationship. */
export function RelationshipControls({ token }: { token: string }) {
  const { session } = useAuth();
  return <AccountRelationshipControls key={`${session?.user.id ?? 'anonymous'}:${token}`} userId={session?.user.id} token={token} />;
}

function AccountRelationshipControls({ token, userId }: { token: string; userId?: string }) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<RelationshipStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<'disconnect' | 'block' | null>(null);
  const [showOptions, setShowOptions] = useState(false);
  const active = useRef(true);
  const load = async () => {
    if (!userId) return;
    setBusy(true); setMessage('');
    try { if (active.current) setStatus(await relationshipStatus(userId, token)); }
    catch (error) { if (active.current) setMessage(relationshipError(error)); }
    finally { if (active.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [token, userId]);
  const run = async (action: 'connect' | 'disconnect' | 'block') => {
    if (!userId || busy) return;
    setBusy(true); setMessage('');
    try {
      if (action === 'connect') await connectProfile(userId, token);
      if (action === 'disconnect' && status?.relationship_id) await disconnectProfile(userId, status.relationship_id);
      if (action === 'block') await blockProfileConnection(userId, token);
      relationshipsChanged();
      if (!active.current) return;
      setConfirm(null);
      if (action === 'block') { setStatus({ state: 'unavailable', relationship_id: null }); setMessage('Blocked. This profile cannot connect with you.'); }
      else { await load(); setMessage(action === 'connect' ? 'Connected. This learner is now in your list.' : 'Disconnected.'); }
    } catch (error) { if (active.current) setMessage(relationshipError(error)); }
    finally { if (active.current) setBusy(false); }
  };
  const button = (label: string, action: () => void, destructive = false) => <Pressable accessibilityRole="button" accessibilityState={{ disabled: busy }} disabled={busy} onPress={action} style={({ pressed }) => ({ minHeight: 48, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 14, backgroundColor: destructive ? colors.dangerSurface : colors.primary, opacity: busy ? 0.55 : pressed ? 0.75 : 1 })}><Text style={{ color: destructive ? colors.danger : colors.onPrimary, fontWeight: '700', textAlign: 'center' }}>{label}</Text></Pressable>;
  if (!userId) return <Text style={{ color: colors.textSecondary }}>Sign in to connect with this learner.</Text>;
  if (status?.state === 'self') return <Text style={{ color: colors.textSecondary }}>This is your profile.</Text>;
  if (status?.state === 'unavailable') return <Text style={{ color: colors.textSecondary }}>This profile is unavailable.</Text>;
  return <View style={{ gap: 10 }}>
    {status?.state === 'available' && <>{button('Connect', () => void run('connect'))}<Text style={{ color: colors.textSecondary }}>Add this learner to your Connections list.</Text></>}
    {status?.state === 'connected' && <>{<Text style={{ color: colors.textSecondary }}>Connected</Text>}{confirm === 'disconnect' ? <>{<Text style={{ color: colors.text }}>Disconnect from this learner?</Text>}{button('Confirm disconnect', () => void run('disconnect'), true)}{button('Keep connected', () => setConfirm(null))}</> : button('Disconnect', () => setConfirm('disconnect'), true)}</>}
    {status && <Pressable accessibilityRole="button" accessibilityState={{ expanded: showOptions }} onPress={() => { setShowOptions(value => !value); setConfirm(null); }} style={{ minHeight: 44, justifyContent: 'center' }}>
      <Text style={{ color: colors.primary }}>{showOptions ? 'Hide options' : 'More options'}</Text>
    </Pressable>}
    {status && showOptions && (confirm === 'block' ? <>{<Text style={{ color: colors.text }}>Block this learner? Both connection lists will be cleared.</Text>}{button('Confirm block', () => void run('block'), true)}{button('Keep unblocked', () => setConfirm(null))}</> : button('Block learner', () => setConfirm('block'), true))}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
    {busy ? <Text accessibilityLiveRegion="polite" style={{ color: colors.textSecondary }}>Updating connection…</Text> : null}
  </View>;
}
