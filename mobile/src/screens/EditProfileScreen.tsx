import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ProfileAvatar, AVATAR_PRESETS, AvatarPreset } from '../components/ProfileAvatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { useOnline } from '../context/ConnectivityContext';
import { normalizeProfileName } from '../services/profileName';

export function EditProfileScreen() {
  const navigation = useNavigation();
  const { progress, updateProfile, uploadAvatar, removeAvatar } = useProgress();
  const { colors } = useTheme(); const online = useOnline();
  const [name, setName] = useState(progress.displayName ?? '');
  const [bio, setBio] = useState(progress.bio ?? '');
  const [saving, setSaving] = useState(false); const [message, setMessage] = useState('');
  const busy = useRef(false); const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  const run = async (work: () => Promise<void>, success: string) => {
    if (busy.current) return; busy.current = true; setSaving(true); setMessage('');
    try { await work(); if (active.current) setMessage(success); }
    catch { if (active.current) setMessage('Could not save your profile. Check your connection and try again.'); }
    finally { busy.current = false; if (active.current) setSaving(false); }
  };
  const save = () => void run(async () => {
    const displayName = normalizeProfileName(name); const normalizedBio = bio.trim().replace(/\s+/g, ' ');
    if (normalizedBio.length > 160) throw new Error('bio too long');
    await updateProfile({ displayName, bio: normalizedBio }); setName(displayName); setBio(normalizedBio);
  }, 'Profile saved.');
  const pick = async (camera: boolean) => {
    const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) { Alert.alert('Photo permission needed', 'Allow access in your phone settings to choose a profile photo.'); return; }
    const result = camera ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 }) : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.85 });
    if (result.canceled || !result.assets[0]) return;
    await run(() => uploadAvatar(result.assets[0].uri, result.assets[0].mimeType || 'image/jpeg'), 'Profile photo saved.');
  };
  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 18 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>← Back</Text></Pressable>
    <ScreenHeader title="Edit profile" subtitle="Your sign-in email stays private. Choose what feels like you." />
    <View style={{ alignItems: 'center', gap: 10 }}><ProfileAvatar avatarRef={progress.avatarRef} avatarUrl={progress.avatarUrl} size={104} />
      <View style={{ flexDirection: 'row', gap: 10 }}><Pressable onPress={() => void pick(false)} disabled={saving} style={{ padding: 12, borderRadius: 14, backgroundColor: colors.primary }}><Text style={{ color: colors.onPrimary, fontWeight: '700' }}>Choose photo</Text></Pressable><Pressable onPress={() => void pick(true)} disabled={saving} style={{ padding: 12, borderRadius: 14, backgroundColor: colors.surface }}><Text style={{ color: colors.primary, fontWeight: '700' }}>Take photo</Text></Pressable></View>
      {progress.avatarRef ? <Pressable onPress={() => void run(removeAvatar, 'Profile photo removed.')} disabled={saving}><Text style={{ color: colors.textSecondary }}>Remove avatar</Text></Pressable> : null}
    </View>
    <Text style={{ color: colors.text, fontWeight: '700' }}>Or choose an avatar</Text><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{AVATAR_PRESETS.map(([id]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Use ${id} avatar`} onPress={() => void run(() => updateProfile({ avatarPreset: id as AvatarPreset }), 'Avatar saved.')}><ProfileAvatar avatarRef={`preset:${id}`} size={54} /></Pressable>)}</View>
    <Text style={{ color: colors.text }}>Preferred name</Text><TextInput accessibilityLabel="Preferred name" value={name} onChangeText={setName} editable={!saving} autoCapitalize="words" style={{ color: colors.text, backgroundColor: colors.surface, borderRadius: 16, padding: 16, fontSize: 18, minHeight: 52 }} />
    <Text style={{ color: colors.text }}>Short bio <Text style={{ color: colors.textMuted }}>({bio.length}/160)</Text></Text><TextInput accessibilityLabel="Short bio" value={bio} onChangeText={setBio} editable={!saving} maxLength={160} multiline style={{ color: colors.text, backgroundColor: colors.surface, borderRadius: 16, padding: 16, minHeight: 84, textAlignVertical: 'top' }} placeholder="What are you learning?" placeholderTextColor={colors.textMuted} />
    {!online && <Text style={{ color: colors.textMuted }}>Connect to save your profile.</Text>}<Pressable accessibilityRole="button" disabled={saving || !online} onPress={save} style={{ minHeight: 52, justifyContent: 'center', borderRadius: 16, backgroundColor: colors.primary, opacity: saving || !online ? 0.55 : 1 }}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>{saving ? 'Saving…' : 'Save profile'}</Text></Pressable>
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
  </ScrollView>;
}
