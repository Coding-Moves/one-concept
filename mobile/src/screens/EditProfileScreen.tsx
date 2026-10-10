import * as ImagePicker from 'expo-image-picker';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { ApiError } from '../api/client';
import { ProfileAvatar, AVATAR_PRESETS, AvatarPreset } from '../components/ProfileAvatar';
import { ScreenHeader } from '../components/ScreenHeader';
import { useAuth } from '../context/AuthContext';
import { useProgress } from '../context/ProgressContext';
import { useTheme } from '../context/ThemeContext';
import { useOnline } from '../context/ConnectivityContext';
import { beginProfilePhotoPick, claimProfilePhotoPick } from '../services/profilePhotoPicker';
import { normalizeProfileName } from '../services/profileName';

function photoSaveError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 0) return 'No connection. Connect and try saving your photo again.';
    if (error.status === 413) return 'Choose a photo smaller than 5 MB.';
    if (error.status === 415 || error.status === 422) return 'This photo could not be used. Choose a JPEG, PNG, or WebP image.';
    if (error.status === 503) return 'Photo saving is unavailable right now. Try again later or choose a built-in avatar.';
    if (error.status === 401) return 'Your account changed. Open Edit profile again to choose a photo.';
  }
  return 'Could not save your photo. Try again or choose another image.';
}

export function EditProfileScreen() {
  const navigation = useNavigation();
  const userId = useAuth().session?.user.id;
  const { progress, updateProfile, uploadAvatar, removeAvatar } = useProgress();
  const { colors } = useTheme();
  const online = useOnline();
  const [name, setName] = useState(progress.displayName ?? '');
  const [bio, setBio] = useState(progress.bio ?? '');
  const [photo, setPhoto] = useState<ImagePicker.ImagePickerAsset | null>(null);
  const [photoError, setPhotoError] = useState('');
  const [photoSuccess, setPhotoSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [savingPhoto, setSavingPhoto] = useState(false);
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const active = useRef(true);
  const currentUserId = useRef(userId);
  currentUserId.current = userId;

  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!userId) return;
    let current = true;
    // Android can recreate the activity while the picker is open. A recovered
    // result is shown for confirmation only to the account that opened it.
    void ImagePicker.getPendingResultAsync().then(async result => {
      if (!result) return;
      const owned = await claimProfilePhotoPick(userId);
      if (!current || !active.current || !owned || currentUserId.current !== userId) return;
      if ('canceled' in result && !result.canceled && result.assets[0]) {
        setPhoto(result.assets[0]);
        setPhotoError('');
        setPhotoSuccess('');
      } else if ('code' in result) setPhotoError('Could not open that photo. Please try again.');
    }).catch(() => { if (current && active.current) setPhotoError('Could not recover that photo. Please choose it again.'); });
    return () => { current = false; };
  }, [userId]);

  const run = async (work: () => Promise<void>, success: string): Promise<boolean> => {
    if (busy.current) return false;
    busy.current = true; setSaving(true); setMessage('');
    try {
      await work();
      if (active.current) setMessage(success);
      return true;
    } catch {
      if (active.current) setMessage('Could not save your profile. Check your connection and try again.');
      return false;
    } finally {
      busy.current = false;
      if (active.current) setSaving(false);
    }
  };
  const save = () => void run(async () => {
    const displayName = normalizeProfileName(name);
    const normalizedBio = bio.trim().replace(/\s+/g, ' ');
    if (normalizedBio.length > 160) throw new Error('bio too long');
    await updateProfile({ displayName, bio: normalizedBio });
    setName(displayName); setBio(normalizedBio);
  }, 'Profile saved.');

  const pick = async (camera: boolean) => {
    if (busy.current || !userId) return;
    try {
      const permission = camera ? await ImagePicker.requestCameraPermissionsAsync() : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Photo permission needed', 'Allow access in your phone settings to choose a profile photo.');
        return;
      }
      await beginProfilePhotoPick(userId);
      const options: ImagePicker.ImagePickerOptions = {
        mediaTypes: ['images'], allowsEditing: false, quality: 0.85,
        preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
      };
      const result = camera ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const owned = await claimProfilePhotoPick(userId);
      if (!owned || !active.current || currentUserId.current !== userId || result.canceled || !result.assets[0]) return;
      setPhoto(result.assets[0]);
      setPhotoError('');
      setPhotoSuccess('');
      setMessage('');
    } catch {
      await claimProfilePhotoPick(userId).catch(() => {});
      if (active.current) { setPhotoSuccess(''); setPhotoError('Could not open that photo. Please try again.'); }
    }
  };

  const savePhoto = async () => {
    if (!photo || busy.current) return;
    if (!online) { setPhotoError('Connect to the internet to save this photo.'); return; }
    if (photo.fileSize && photo.fileSize > 5 * 1024 * 1024) { setPhotoError('Choose a photo smaller than 5 MB.'); return; }
    busy.current = true; setSaving(true); setSavingPhoto(true); setPhotoError(''); setPhotoSuccess(''); setMessage('');
    try {
      await uploadAvatar(photo.uri, photo.mimeType || 'image/jpeg');
      if (active.current) { setPhoto(null); setPhotoSuccess('Profile photo saved.'); }
    } catch (error) {
      if (active.current) setPhotoError(photoSaveError(error));
    } finally {
      busy.current = false;
      if (active.current) { setSaving(false); setSavingPhoto(false); }
    }
  };

  const choosePreset = async (id: AvatarPreset) => {
    if (await run(() => updateProfile({ avatarPreset: id }), '') && active.current) {
      setPhoto(null); setPhotoSuccess('Avatar saved.');
    }
  };
  const remove = async () => {
    if (await run(removeAvatar, '') && active.current) {
      setPhoto(null); setPhotoSuccess('Profile photo removed.');
    }
  };

  return <ScrollView keyboardShouldPersistTaps="handled" style={{ flex: 1, backgroundColor: colors.background }} contentContainerStyle={{ padding: 24, gap: 18 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.goBack()} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>← Back</Text></Pressable>
    <ScreenHeader title="Edit profile" subtitle="Your sign-in email stays private. Choose what feels like you." />
    <View style={{ alignItems: 'center', gap: 10 }}>
      {!photo ? <ProfileAvatar avatarRef={progress.avatarRef} avatarUrl={progress.avatarUrl} size={104} /> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 }}>
        <Pressable accessibilityRole="button" onPress={() => void pick(false)} disabled={saving} style={{ padding: 12, borderRadius: 14, backgroundColor: colors.primary, opacity: saving ? 0.5 : 1 }}><Text style={{ color: colors.onPrimary, fontWeight: '700' }}>Choose photo</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => void pick(true)} disabled={saving} style={{ padding: 12, borderRadius: 14, backgroundColor: colors.surface, opacity: saving ? 0.5 : 1 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>Take photo</Text></Pressable>
      </View>
      {progress.avatarRef && !photo ? <Pressable accessibilityRole="button" onPress={() => void remove()} disabled={saving}><Text style={{ color: colors.textSecondary }}>Remove avatar</Text></Pressable> : null}
      {photoSuccess ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{photoSuccess}</Text> : null}
    </View>
    {photo ? <View style={{ alignItems: 'center', gap: 12, padding: 16, borderRadius: 20, backgroundColor: colors.surface }}>
      <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>Preview your photo</Text>
      <Image accessibilityLabel="Selected profile photo preview" source={{ uri: photo.uri }} resizeMode="cover" style={{ width: 180, height: 180, borderRadius: 90 }} />
      <Text style={{ color: colors.textSecondary, textAlign: 'center' }}>The centered area shown here will be your profile photo.</Text>
      <Pressable accessibilityRole="button" disabled={saving || !online} onPress={() => void savePhoto()} style={{ minHeight: 52, alignSelf: 'stretch', justifyContent: 'center', borderRadius: 16, backgroundColor: colors.primary, opacity: saving || !online ? 0.55 : 1 }}>
        <Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>{savingPhoto ? 'Saving photo…' : 'Save photo'}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => void pick(false)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>Choose another photo</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={saving} onPress={() => { setPhoto(null); setPhotoError(''); }} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.primary }}>Cancel photo change</Text></Pressable>
      {savingPhoto ? <ActivityIndicator color={colors.primary} accessibilityLabel="Saving photo" /> : null}
      {!online ? <Text style={{ color: colors.textSecondary }}>Connect to save your photo.</Text> : null}
      {photoError ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, textAlign: 'center' }}>{photoError}</Text> : null}
    </View> : photoError ? <Text accessibilityLiveRegion="polite" style={{ color: colors.danger, textAlign: 'center' }}>{photoError}</Text> : null}
    <Text style={{ color: colors.text, fontWeight: '700' }}>Or choose an avatar</Text>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>{AVATAR_PRESETS.map(([id]) => <Pressable key={id} accessibilityRole="button" accessibilityLabel={`Use ${id} avatar`} disabled={saving} onPress={() => void choosePreset(id as AvatarPreset)}><ProfileAvatar avatarRef={`preset:${id}`} size={54} /></Pressable>)}</View>
    <Text style={{ color: colors.text }}>Preferred name</Text>
    <TextInput accessibilityLabel="Preferred name" value={name} onChangeText={setName} editable={!saving} autoCapitalize="words" style={{ color: colors.text, backgroundColor: colors.surface, borderRadius: 16, padding: 16, fontSize: 18, minHeight: 52 }} />
    <Text style={{ color: colors.text }}>Short bio <Text style={{ color: colors.textMuted }}>({bio.length}/160)</Text></Text>
    <TextInput accessibilityLabel="Short bio" value={bio} onChangeText={setBio} editable={!saving} maxLength={160} multiline style={{ color: colors.text, backgroundColor: colors.surface, borderRadius: 16, padding: 16, minHeight: 84, textAlignVertical: 'top' }} placeholder="What are you learning?" placeholderTextColor={colors.textMuted} />
    {!online && <Text style={{ color: colors.textMuted }}>Connect to save your profile.</Text>}
    <Pressable accessibilityRole="button" disabled={saving || !online} onPress={save} style={{ minHeight: 52, justifyContent: 'center', borderRadius: 16, backgroundColor: colors.primary, opacity: saving || !online ? 0.55 : 1 }}><Text style={{ color: colors.onPrimary, textAlign: 'center', fontWeight: '700' }}>{saving ? 'Saving…' : 'Save profile'}</Text></Pressable>
    {message ? <Text accessibilityLiveRegion="polite" style={{ color: colors.text }}>{message}</Text> : null}
  </ScrollView>;
}
