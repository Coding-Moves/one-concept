import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { useOnline } from '../context/ConnectivityContext';
import { normalizeProfileName } from '../services/profileName';

export function EditProfileScreen() {
  const navigation = useNavigation();
  const { progress, updateDisplayName } = useProgress();
  const { colors } = useTheme();
  const online = useOnline();
  const [name, setName] = useState(progress.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saveSucceeded, setSaveSucceeded] = useState(false);
  const busy = useRef(false);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const save = async () => {
    if (busy.current) return;
    let normalized: string;
    try { normalized = normalizeProfileName(name); }
    catch (error) { setMessage((error as Error).message); return; }
    busy.current = true; setSaving(true); setMessage(''); setSaveSucceeded(false);
    try {
      await updateDisplayName(normalized);
      if (active.current) { setName(normalized); setSaveSucceeded(true); setMessage('Name saved. Your profile now uses this name.'); }
    } catch {
      if (active.current) { setSaveSucceeded(false); setMessage('Could not save your name. Check your connection and try again. Your text is still here.'); }
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  };
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 20 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>← Back</Text></Pressable>
    <ScreenHeader title="Edit profile" subtitle="Choose the name you prefer. Your email and sign-in details stay the same." />
    <Text style={{ color: colors.text }}>Preferred name</Text>
    <TextInput accessibilityLabel="Preferred name" value={name} onChangeText={setName} editable={!saving} autoCapitalize="words" autoCorrect={false} returnKeyType="done" onSubmitEditing={() => void save()} style={{ color: colors.text, backgroundColor: colors.surface, borderRadius: 16, padding: 16, fontSize: 18, minHeight: 52 }} />
    {!online && <Text style={{ color: colors.textMuted }}>You need a connection to save. You can retry when you reconnect.</Text>}
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: saving, busy: saving }} disabled={saving} onPress={() => void save()} style={({ pressed }) => ({ minHeight: 48, backgroundColor: pressed ? colors.primaryPressed : colors.primary, padding: 16, borderRadius: 16, opacity: saving ? 0.6 : 1 })}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>{saving ? 'Saving…' : 'Save name'}</Text></Pressable>
    {message ? <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, borderRadius: 12, backgroundColor: saveSucceeded ? colors.surfaceSubtle : colors.surface }}><Text style={{ color: saveSucceeded ? colors.primary : colors.text, fontWeight: '700' }}>{saveSucceeded ? '✓' : '!'}</Text><Text style={{ flex: 1, color: colors.text }}>{message}</Text></View> : null}
  </ScrollView>;
}
