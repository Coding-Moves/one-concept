import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, ScrollView, Share, Switch, Text, View } from 'react-native';
import { ShareProfileSheet } from '../components/ShareProfileSheet';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useProgress } from '../context/ProgressContext';
import { useOnline } from '../context/ConnectivityContext';
import { apiRequest } from '../api/client';
import { getSharing, putSharing, publicProfileUrl, getPublicProfile, PublicProfile, SharingSettings } from '../services/profileSharing';

export function ProfileSharingScreen() {
  const navigation = useNavigation();
  const { session } = useAuth();
  const userId = session!.user.id;
  const { colors } = useTheme();
  const online = useOnline();
  const { progress } = useProgress();
  const [saved, setSaved] = useState<SharingSettings | null>(null);
  const [draft, setDraft] = useState<SharingSettings | null>(null);
  const [awards, setAwards] = useState<{code: string; name: string; earned_on: string | null}[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = useRef(true);
  const pending = useRef(false);
  const presentation = useRef(0);
  const [preview, setPreview] = useState<{url: string; profile: PublicProfile} | null>(null);
  const load = useCallback(async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); setPreview(null);
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
    const subscription = AppState.addEventListener('change', () => { presentation.current += 1; setPreview(null); });
    return () => subscription.remove();
  }, []);
  const persist = async (enabled: boolean) => {
    if (!draft || pending.current) return;
    pending.current = true; setBusy(true); setMessage(''); setPreview(null);
    try {
      const result = await putSharing(userId, { ...(enabled ? draft : saved ?? draft), enabled });
      if (active.current) { setSaved(result); setDraft(result); setMessage(enabled ? 'Your selected information is now public.' : 'Sharing is off. Previous links no longer work.'); }
    } catch { if (active.current) setMessage('Changes were not confirmed. Check your connection, then reload to see the current settings before retrying.'); }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const share = async (qr: boolean) => {
    if (pending.current) return;
    const opening = ++presentation.current;
    pending.current = true; setBusy(true);
    try {
      const current = await getSharing(userId);
      if (!active.current) return;
      setSaved(current); setDraft(current);
      if (!current.enabled || !current.public_path) { setPreview(null); setMessage('Sharing is off. Enable it before sharing a link.'); return; }
      const url = publicProfileUrl(current.public_path);
      const profile = await getPublicProfile(current.public_path.slice(3));
      if (!active.current || opening !== presentation.current) return;
      setPreview({url, profile});
      if (!qr) await Share.share({ message: url });
    } catch { if (active.current) { setPreview(null); setMessage('Could not prepare your link. Check your connection and try again.'); } }
    finally { pending.current = false; if (active.current) setBusy(false); }
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const discardDraft = () => { if (saved) { setDraft(saved); setMessage('Unsaved choices discarded.'); } };
  const button = (label: string, action: () => void, disabled = busy) => <Pressable key={label} accessibilityRole="button" accessibilityState={{ disabled }} disabled={disabled} onPress={action} style={({ pressed }) => ({ minHeight: 48, padding: 14, borderRadius: 14, backgroundColor: colors.surface, opacity: disabled ? 0.5 : pressed ? 0.7 : 1 })}><Text style={{ color: colors.primary, fontWeight: '700' }}>{label}</Text></Pressable>;
  const toggle = (label: string, checked: boolean, onChange: (value: boolean) => void) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 16, minHeight: 48 }}><Text style={{ flex: 1, color: colors.text }}>{label}</Text><Switch accessibilityLabel={label} disabled={busy} value={checked} onValueChange={value => { setPreview(null); onChange(value); }} /></View>;
  return <><ShareProfileSheet value={preview} busy={busy} onClose={() => { presentation.current += 1; setPreview(null); }} onShare={() => void share(false)} /><ScrollView style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 18 }}>
    {button('← Back', () => navigation.goBack(), false)}
    <ScreenHeader title="Public profile" subtitle="Private by default. Choose exactly what a link can show." />
    <View accessibilityRole="summary" style={{ gap: 4, padding: 14, borderRadius: 14, backgroundColor: colors.surface }}>
      <Text style={{ color: colors.text, fontWeight: '700' }}>Sharing is {saved ? saved.enabled ? 'on' : 'off' : 'loading'}</Text>
      <Text style={{ color: colors.textMuted }}>{saved?.enabled ? 'Only the fields selected below are visible from your link.' : 'Nothing is public until you enable sharing.'}</Text>
    </View>
    <Text style={{ color: colors.textMuted }}>Your email, saved concepts and private activity are never shared. Turning sharing off stops new link visits; it cannot remove copies someone already made.</Text>
    {!online && <Text style={{ color: colors.text }}>Connect to save settings or prepare a share link.</Text>}
    {draft && <>
      {toggle(`Display name: ${progress.displayName || 'Learner'}`, draft.show_name, show_name => setDraft({ ...draft, show_name }))}
      {toggle('Current and longest streak', draft.show_streak, show_streak => setDraft({ ...draft, show_streak }))}
      {toggle('Total concepts learned', draft.show_learning, show_learning => setDraft({ ...draft, show_learning }))}
      <Text accessibilityRole="header" style={{ color: colors.text, fontWeight: '700' }}>Choose achievements to share</Text>
      {awards.length === 0 && <Text style={{ color: colors.textMuted }}>No earned achievements to share yet.</Text>}
      {awards.map(a => toggle(a.name, draft.achievement_codes.includes(a.code), checked => setDraft({ ...draft, achievement_codes: checked ? [...draft.achievement_codes, a.code] : draft.achievement_codes.filter(code => code !== a.code) })))}
      {dirty && <View accessibilityLiveRegion="polite" style={{ padding: 12, borderRadius: 12, backgroundColor: colors.surfaceSubtle }}><Text style={{ color: colors.text, fontWeight: '700' }}>Unsaved choices</Text><Text style={{ color: colors.textMuted }}>Save to update your link, or discard to return to the last saved settings.</Text></View>}
      {button(saved?.enabled ? 'Save public choices' : 'Enable sharing with these choices', () => void persist(true))}
      {dirty && saved && button('Discard unsaved choices', discardDraft, busy)}
      {saved?.enabled && button('Turn off sharing', () => void persist(false))}
      {saved?.enabled && !dirty && button('Preview & share profile', () => void share(true))}
    </>}
    {busy && <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>Saving or loading settings…</Text>}
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
    {dirty && <Text style={{ color: colors.textMuted }}>Save or discard your choices before reloading.</Text>}
    {button('Reload saved settings', () => void load(), busy || dirty)}
  </ScrollView></>;
}
