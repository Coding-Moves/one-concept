import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { actOnConnection, blockProfile, connectionError, connectionStatus, ConnectionStatus, requestConnection, connectionsChanged } from '../services/connections';

export function ConnectionControls({ token }: { token: string }) {
  const { session } = useAuth();
  return <AccountControls key={`${session?.user.id ?? 'anonymous'}:${token}`} token={token} userId={session?.user.id} />;
}
function AccountControls({ token, userId }: { token: string; userId?: string }) {
  const { colors } = useTheme();
  const [status, setStatus] = useState<ConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const active = useRef(true), pending = useRef(false);
  const load = async () => {
    if (!userId || pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try { const result = await connectionStatus(userId, token); if (active.current) setStatus(result); }
    catch (error) { if (active.current) setMessage(connectionError(error)); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, []);
  const run = async (action: 'request' | 'accept' | 'decline' | 'cancel' | 'remove' | 'block') => {
    if (!userId || pending.current) return;
    pending.current = true; setBusy(true); setMessage('');
    try {
      if (action === 'request') await requestConnection(userId, token);
      else if (action === 'block' && !status?.id) await blockProfile(userId, token);
      else if (status?.id) await actOnConnection(userId, status.id, action);
      connectionsChanged();
      if (!active.current) return;
      setConfirmBlock(false); setConfirmRemove(false);
      const current = await connectionStatus(userId, token);
      if (active.current) { setStatus(current); setMessage(action === 'request' ? 'Request sent. They decide whether to accept.' : action === 'block' ? 'Blocked. You can manage blocked learners in Connections.' : 'Connection updated.'); }
    } catch (error) { if (active.current) setMessage(connectionError(error)); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const button = (label: string, fn: () => void) => <Pressable key={label} accessibilityRole="button" disabled={busy} accessibilityState={{ disabled: busy }} onPress={fn} style={({ pressed }) => ({ padding: 14, minHeight: 48, borderRadius: 14, backgroundColor: colors.surfaceSubtle, opacity: busy ? 0.5 : pressed ? 0.7 : 1 })}><Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text></Pressable>;
  if (!userId) return <Text style={{ color: colors.textSecondary }}>Sign in to One Concept, then open this link again to request a connection.</Text>;
  return <View style={{ gap: 12 }}>
    <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700', fontSize: 20 }}>Connections</Text>
    {status?.state === 'available' && <><Text style={{ color: colors.textSecondary }}>Sending a request shares only your currently public profile details with this learner. They must accept before you connect.</Text>{button('Send connection request', () => void run('request'))}</>}
    {status?.state === 'incoming' && <><Text style={{ color: colors.text }}>This learner would like to connect.</Text>{button('Accept request', () => void run('accept'))}{button('Decline request', () => void run('decline'))}</>}
    {status?.state === 'outgoing' && <><Text style={{ color: colors.text }}>Request pending</Text>{button('Cancel request', () => void run('cancel'))}</>}
    {status?.state === 'accepted' && <><Text style={{ color: colors.text }}>You are connected</Text>{confirmRemove ? <><Text style={{ color: colors.text }}>Remove this connection? A new request requires a seven-day wait.</Text>{button('Confirm remove', () => void run('remove'))}{button('Keep connection', () => setConfirmRemove(false))}</> : button('Remove connection', () => setConfirmRemove(true))}</>}
    {status?.state === 'self' && <Text style={{ color: colors.textSecondary }}>This is your profile.</Text>}
    {status?.state === 'cooldown' && <Text style={{ color: colors.textSecondary }}>A previous request ended. You can try again in about {Math.max(1, Math.ceil((status.retry_after ?? 0) / 86400))} days.</Text>}
    {status?.state === 'unavailable' && <Text style={{ color: colors.textSecondary }}>Requests are unavailable. Your public sharing must be enabled, and the other learner must accept new requests.</Text>}
    {status && !['self', 'unavailable'].includes(status.state) && (confirmBlock ? <><Text style={{ color: colors.text }}>Block this learner? Requests and any existing connection will be removed. Public links remain public until sharing is turned off.</Text>{button('Confirm block', () => void run('block'))}{button('Keep unblocked', () => setConfirmBlock(false))}</> : button('Block learner', () => setConfirmBlock(true)))}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
    {busy && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Please wait…</Text>}
    {button('Reload connection status', () => void load())}
  </View>;
}
