import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, Switch, Text, View, useWindowDimensions } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useProgress } from '../context/ProgressContext';
import { useOnline } from '../context/ConnectivityContext';
import { apiRequest } from '../api/client';
import { getSharing, putSharing, publicProfileUrl, profileQr, SharingSettings } from '../services/profileSharing';

export function ProfileSharingScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors } = useTheme();
  const online = useOnline();
  const { progress } = useProgress();
  const { width } = useWindowDimensions();
  const [saved, setSaved] = useState<SharingSettings | null>(null);
  const [draft, setDraft] = useState<SharingSettings | null>(null);
  const [awards, setAwards] = useState<{code: string; name: string; earned_on: string | null}[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); setQrUrl(null);
    try {
      const settings = await getSharing(userId);
      if (active.current) { setSaved(settings); setDraft(settings); }
      const earned = await apiRequest<{items: typeof awards}>('/v1/me/achievements', { expectedUserId: userId });
      if (active.current) setAwards(earned.items.filter(a => a.earned_on));
    } catch { if (active.current) setMessage('Could not load your sharing settings. Check your connection and reload.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  }, [userId]);
  useEffect(() => { active.current = true; void load(); return () => { active.current = false; }; }, [load]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', () => setQrUrl(null));
    return () => subscription.remove();
  }, []);
  const persist = async (enabled: boolean) => {
    if (!draft || pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); setQrUrl(null);
    try {
      const result = await putSharing(userId, { ...(enabled ? draft : saved ?? draft), enabled });
      if (active.current) { setSaved(result); setDraft(result); setMessage(enabled ? 'Your selected information is now public.' : 'Sharing is off. Previous links no longer work.'); }
    } catch { if (active.current) setMessage('Changes were not confirmed. Check your connection, then reload to see the current settings before retrying.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const share = async (qr: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setQrUrl(null);
    try {
      const current = await getSharing(userId);
      if (!active.current) return;
      setSaved(current); setDraft(current);
      if (!current.enabled || !current.public_path) { setMessage('Sharing is off. Enable it before sharing a link.'); return; }
      const url = publicProfileUrl(current.public_path);
      if (qr) setQrUrl(url);
      else await Share.share({ message: url });
    } catch { if (active.current) setMessage('Could not prepare your link. Check your connection and try again.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const matrix = useMemo(() => qrUrl ? profileQr(qrUrl) : null, [qrUrl]);
  const pixel = matrix ? Math.max(1, Math.min(4, Math.floor((width - 48) / (matrix.length + 8)))) : 4;
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const button = (label: string, action: () => void, disabled = busy) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={({ pressed }) => ({ minHeight: 48, padding: 14, borderRadius: 14, backgroundColor: colors.surface, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}><Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text></Pressable>;
  const toggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 48 }}><Text style={{ flex: 1, color: colors.text }}>{label}</Text><Switch accessibilityLabel={label} disabled={busy} value={checked} onValueChange={value => { setQrUrl(null); onChange(value); }} /></View>;
  return <ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 18 }}>
    {button('← Back', () => navigation.goBack(), false)}
    <ScreenHeader title="Public profile" subtitle="Private by default. Anyone with your link can see the fields you choose below, and may copy them." />
    <Text style={{ color: colors.text }}>Sharing: {saved ? saved.enabled ? 'On' : 'Off' : 'Loading…'}</Text>
    <Text style={{ color: colors.textMuted }}>Your email, saved concepts and private activity are never included. Disabling sharing stops future access; it cannot remove copies someone already made.</Text>
    {!online && <Text style={{ color: colors.text }}>Connect to save settings or prepare a share link.</Text>}
    {draft && <>
      {toggle(`Display name: ${progress.displayName || 'Learner'}`, draft.show_name, show_name => setDraft({ ...draft, show_name }))}
      {toggle('Current and longest streak', draft.show_streak, show_streak => setDraft({ ...draft, show_streak }))}
      {toggle('Total concepts learned', draft.show_learning, show_learning => setDraft({ ...draft, show_learning }))}
      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>Choose achievements to share</Text>
      {awards.length === 0 && <Text style={{ color: colors.textMuted }}>No earned achievements to share yet.</Text>}
      {awards.map(a => toggle(a.name, draft.achievement_codes.includes(a.code), checked => setDraft({ ...draft, achievement_codes: checked ? [...draft.achievement_codes, a.code] : draft.achievement_codes.filter(code => code !== a.code) })))}
      {button(saved?.enabled ? 'Save public choices' : 'Enable sharing with these choices', () => void persist(true))}
      {saved?.enabled && button('Turn off sharing now', () => void persist(false))}
      {dirty && <Text style={{ color: colors.text }}>Save your choices to apply them.</Text>}
      {saved?.enabled && !dirty && <>
        {button('Share profile link', () => void share(false))}
        {button('Show profile QR', () => void share(true))}
      </>}
    </>}
    {matrix && qrUrl && <View accessible accessibilityLabel="QR code containing only your public profile link" style={{ alignSelf: 'center', backgroundColor: 'white', padding: pixel * 4 }}>
      {matrix.map((row, y) => <View key={y} style={{ flexDirection: 'row', height: pixel }}>{row.map((dark, x) => <View key={x} style={{ width: pixel, height: pixel, backgroundColor: dark ? 'black' : 'white' }} />)}</View>)}
    </View>}
    {qrUrl && <Text selectable style={{ color: colors.text }}>{qrUrl}</Text>}
    {busy && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Please wait…</Text>}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
    {button('Reload settings', () => void load())}
  </ScrollView>;
}
